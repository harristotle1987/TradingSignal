/**
 * Finnhub Market Data Adapter
 * Fetches real stock, forex, and crypto ticker data from Finnhub API.
 * STRICT POLICY: Requires valid server-side FINNHUB_API_KEY. Never fabricates data.
 */

import { IMarketDataProvider } from './IMarketDataProvider.js';
import { NormalizedTicker, NormalizedCandle, ProviderHealth } from '../types.js';
import { SymbolNormalizer } from '../SymbolNormalizer.js';
import { serverConfig } from '../../config.js';
import { logger } from '../../logger.js';

interface FinnhubQuoteResponse {
  c: number;   // Current price
  h: number;   // High
  l: number;   // Low
  o: number;   // Open
  pc: number;  // Previous close
  t: number;   // Timestamp (seconds)
  error?: string;
}

export class FinnhubAdapter implements IMarketDataProvider {
  readonly id = 'finnhub';
  readonly name = 'Finnhub Market Data';

  async fetchPrice(appSymbol: string, globalScanDeadlineMs?: number): Promise<NormalizedTicker> {
    const receivedAt = Date.now();
    let providerSymbol = appSymbol;
    let assetType: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN' = 'STOCK';

    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return this.createErrorTicker(
        appSymbol,
        providerSymbol,
        assetType,
        'Finnhub API key not configured in environment variables (FINNHUB_API_KEY)'
      );
    }

    const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
    let timeoutMs = configTimeout;
    const safetyMargin = 100;
    if (globalScanDeadlineMs) {
      const remainingMs = globalScanDeadlineMs - Date.now();
      if (remainingMs <= safetyMargin) {
        throw new Error('TIMEOUT: Global scanner deadline reached before starting request');
      }
      timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
      providerSymbol = mapping.providerSymbol;
      assetType = mapping.assetType;
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(providerSymbol)}&token=${encodeURIComponent(apiKey.trim())}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (response.status === 401 || response.status === 403) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Invalid or unauthorized Finnhub API key');
      }

      if (response.status === 429) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Finnhub API rate limit exceeded (HTTP 429)');
      }

      if (!response.ok) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Finnhub API returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as FinnhubQuoteResponse;

      if (json.error) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Finnhub error: ${json.error}`);
      }

      let price = json.c;
      const timestampSec = json.t;
      if ((typeof price !== 'number' || isNaN(price) || !isFinite(price) || price <= 0) && typeof json.pc === 'number' && !isNaN(json.pc) && isFinite(json.pc) && json.pc > 0) {
        price = json.pc;
      }

      if (typeof price !== 'number' || isNaN(price) || !isFinite(price) || price <= 0) {
        return this.createErrorTicker(
          appSymbol,
          providerSymbol,
          assetType,
          `Finnhub returned no valid price for symbol ${providerSymbol} (c: ${json.c}, pc: ${json.pc})`
        );
      }

      const timestamp = (typeof timestampSec === 'number' && timestampSec > 0)
        ? timestampSec * 1000
        : receivedAt;

      const isFresh = true;

      return {
        symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
        rawSymbol: providerSymbol,
        provider: this.id,
        assetType,
        bid: null,
        ask: null,
        price,
        timestamp,
        receivedAt,
        source: 'LIVE',
        isFresh,
        status: isFresh ? 'OK' : 'STALE',
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Finnhub connection failed: ${msg}`);
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const apiKey = process.env.FINNHUB_API_KEY;
    const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);

    if (!isConfigured) {
      return {
        provider: this.id,
        name: this.name,
        configured: false,
        status: 'UNAVAILABLE',
        lastChecked: new Date().toISOString(),
        errorMessage: 'FINNHUB_API_KEY environment variable is missing',
      };
    }

    const start = Date.now();
    try {
      const ticker = await this.fetchPrice('AAPL');
      const latencyMs = Date.now() - start;

      if (ticker.status === 'OK' || ticker.status === 'STALE') {
        return {
          provider: this.id,
          name: this.name,
          configured: true,
          status: 'CONNECTED',
          latencyMs,
          lastChecked: new Date().toISOString(),
        };
      } else {
        return {
          provider: this.id,
          name: this.name,
          configured: true,
          status: 'UNAVAILABLE',
          latencyMs,
          lastChecked: new Date().toISOString(),
          errorMessage: ticker.errorMessage,
        };
      }
    } catch (err) {
      return {
        provider: this.id,
        name: this.name,
        configured: true,
        status: 'UNAVAILABLE',
        lastChecked: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private mapTimeframeToFinnhubResolution(timeframe: string): { resolution: string; secondsPerBar: number } | null {
    const tf = timeframe.toLowerCase().trim();
    switch (tf) {
      case '1m': case '1min': return { resolution: '1', secondsPerBar: 60 };
      case '5m': case '5min': return { resolution: '5', secondsPerBar: 300 };
      case '15m': case '15min': return { resolution: '15', secondsPerBar: 900 };
      case '30m': case '30min': return { resolution: '30', secondsPerBar: 1800 };
      case '1h': case '1hour': case '60m': return { resolution: '60', secondsPerBar: 3600 };
      case '1d': case '1day': return { resolution: 'D', secondsPerBar: 86400 };
      case '1w': case '1week': return { resolution: 'W', secondsPerBar: 604800 };
      default: return null;
    }
  }

  async fetchCandles(appSymbol: string, timeframe = '1m', limit = 50, globalScanDeadlineMs?: number): Promise<NormalizedCandle[]> {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      logger.warn('FINNHUB_API_KEY environment variable missing for stock candle fetching');
      return [];
    }

    const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
    const providerSymbol = mapping.providerSymbol;

    const resInfo = this.mapTimeframeToFinnhubResolution(timeframe);
    if (!resInfo) {
      logger.info(`Timeframe '${timeframe}' not supported natively by Finnhub for ${appSymbol}`);
      return [];
    }

    const toSec = Math.floor(Date.now() / 1000);
    // Calculate window back in time generously to account for non-trading hours / weekends
    const windowSec = Math.max(limit * resInfo.secondsPerBar * 5, 7 * 86400);
    const fromSec = toSec - windowSec;

    const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
    let timeoutMs = configTimeout;
    const safetyMargin = 100;
    if (globalScanDeadlineMs) {
      const remainingMs = globalScanDeadlineMs - Date.now();
      if (remainingMs <= safetyMargin) {
        throw new Error('TIMEOUT: Global scanner deadline reached before starting request');
      }
      timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let endpointPath = 'stock/candle';
      if (mapping.assetType === 'FOREX') {
        endpointPath = 'forex/candle';
      } else if (mapping.assetType === 'CRYPTO') {
        endpointPath = 'crypto/candle';
      }

      const url = `https://finnhub.io/api/v1/${endpointPath}?symbol=${encodeURIComponent(providerSymbol)}&resolution=${resInfo.resolution}&from=${fromSec}&to=${toSec}&token=${encodeURIComponent(apiKey.trim())}`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn(`Finnhub ${mapping.assetType} candle endpoint returned HTTP ${response.status} for ${appSymbol}`);
        return [];
      }

      const json = (await response.json()) as {
        c?: number[];
        h?: number[];
        l?: number[];
        o?: number[];
        s?: string;
        t?: number[];
        v?: number[];
      };

      if (json.s !== 'ok' || !Array.isArray(json.c) || json.c.length === 0) {
        logger.info(`Finnhub returned no candle data (status: ${json.s}) for ${appSymbol} (${timeframe})`);
        return [];
      }

      const normSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
      const candles: NormalizedCandle[] = [];
      const count = json.c.length;

      for (let i = 0; i < count; i++) {
        const open = json.o?.[i];
        const high = json.h?.[i];
        const low = json.l?.[i];
        const close = json.c?.[i];
        const timestampSec = json.t?.[i];
        const vol = json.v?.[i];

        if (
          typeof open === 'number' && !isNaN(open) && open > 0 &&
          typeof high === 'number' && !isNaN(high) && high > 0 &&
          typeof low === 'number' && !isNaN(low) && low > 0 &&
          typeof close === 'number' && !isNaN(close) && close > 0 &&
          typeof timestampSec === 'number' && timestampSec > 0
        ) {
          candles.push({
            symbol: normSymbol,
            provider: this.id,
            timeframe,
            open,
            high,
            low,
            close,
            volume: typeof vol === 'number' && !isNaN(vol) ? vol : null,
            timestamp: timestampSec * 1000,
          });
        }
      }

      candles.sort((a, b) => b.timestamp - a.timestamp);
      return candles.slice(0, limit);
    } catch (err) {
      clearTimeout(timeoutId);
      logger.warn(`Failed to fetch candles from Finnhub for ${appSymbol}`, { error: String(err) });
      return [];
    }
  }

  private createErrorTicker(
    appSymbol: string,
    rawSymbol: string,
    assetType: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN',
    errorMessage: string
  ): NormalizedTicker {
    return {
      symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
      rawSymbol,
      provider: this.id,
      assetType,
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
