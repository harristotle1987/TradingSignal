/**
 * Open Exchange Rates Forex Market Data Adapter
 * Provides real-time Forex conversion rates for standard currency pairs.
 * Serves as a reliable fallback provider when primary Twelve Data API hits rate limits.
 */

import { IMarketDataProvider } from './IMarketDataProvider.js';
import { NormalizedTicker, ProviderHealth } from '../types.js';
import { SymbolNormalizer } from '../SymbolNormalizer.js';
import { serverConfig } from '../../config.js';

interface ExchangeRateResponse {
  result?: string;
  base_code?: string;
  rates?: Record<string, number>;
  time_last_update_unix?: number;
}

export class ExchangeRateAdapter implements IMarketDataProvider {
  readonly id = 'exchangerate';
  readonly name = 'Open Exchange Rates (Forex Fallback)';

  async fetchPrice(appSymbol: string): Promise<NormalizedTicker> {
    const receivedAt = Date.now();
    let providerSymbol = appSymbol;

    try {
      const norm = SymbolNormalizer.normalizeAppSymbol(appSymbol);
      if (!norm || norm.length < 6) {
        return this.createErrorTicker(appSymbol, providerSymbol, 'Invalid Forex symbol format');
      }

      const base = norm.slice(0, 3);
      const quote = norm.slice(3, 6);
      providerSymbol = `${base}/${quote}`;

      const timeoutMs = serverConfig.getConfig().marketDataTimeoutMs;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const url = `https://open.er-api.com/v6/latest/${base}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return this.createErrorTicker(appSymbol, providerSymbol, `ExchangeRate API returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as ExchangeRateResponse;
      if (!json.rates || typeof json.rates[quote] !== 'number') {
        return this.createErrorTicker(appSymbol, providerSymbol, `Rate for pair ${base}/${quote} not available`);
      }

      const price = json.rates[quote];
      if (isNaN(price) || price <= 0) {
        return this.createErrorTicker(appSymbol, providerSymbol, `Invalid rate ${price} returned for ${base}/${quote}`);
      }

      const timestamp = json.time_last_update_unix ? json.time_last_update_unix * 1000 : receivedAt;

      return {
        symbol: norm,
        rawSymbol: providerSymbol,
        provider: this.id,
        assetType: 'FOREX',
        bid: null,
        ask: null,
        price,
        timestamp,
        receivedAt,
        source: 'LIVE',
        isFresh: true,
        status: 'OK',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.createErrorTicker(appSymbol, providerSymbol, `ExchangeRate fetch failed: ${msg}`);
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await this.fetchPrice('EURUSD');
      if (res.status === 'OK' && res.price > 0) {
        return {
          provider: this.id,
          name: this.name,
          configured: true,
          status: 'CONNECTED',
          latencyMs: Date.now() - start,
          lastChecked: new Date().toISOString(),
        };
      }
      return {
        provider: this.id,
        name: this.name,
        configured: true,
        status: 'UNAVAILABLE',
        lastChecked: new Date().toISOString(),
        errorMessage: res.errorMessage || 'Unknown error',
      };
    } catch (err) {
      return {
        provider: this.id,
        name: this.name,
        configured: true,
        status: 'UNAVAILABLE',
        lastChecked: new Date().toISOString(),
        errorMessage: String(err),
      };
    }
  }

  private createErrorTicker(symbol: string, rawSymbol: string, errorMessage: string): NormalizedTicker {
    return {
      symbol: SymbolNormalizer.normalizeAppSymbol(symbol),
      rawSymbol,
      provider: this.id,
      assetType: 'FOREX',
      bid: null,
      ask: null,
      price: 0,
      timestamp: 0,
      receivedAt: Date.now(),
      source: 'LIVE',
      isFresh: false,
      status: 'MARKET_DATA_UNAVAILABLE',
      errorMessage,
    };
  }
}
