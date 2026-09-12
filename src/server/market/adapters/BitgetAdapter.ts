/**
 * Bitget Exchange Market Data Adapter
 * Fetches real crypto ticker and candle market data from Bitget v2 REST API.
 */

import { IMarketDataProvider } from './IMarketDataProvider.js';
import { NormalizedTicker, NormalizedCandle, ProviderHealth } from '../types.js';
import { SymbolNormalizer } from '../SymbolNormalizer.js';
import { aggregateOHLCCandles } from '../CandleAggregator.js';
import { serverConfig } from '../../config.js';
import { logger } from '../../logger.js';

interface BitgetTickerItem {
  symbol: string;
  lastPr: string;
  bidPr?: string;
  askPr?: string;
  ts: string;
}

interface BitgetTickerResponse {
  code: string;
  msg: string;
  requestTime?: number;
  data?: BitgetTickerItem[];
}

export class BitgetAdapter implements IMarketDataProvider {
  readonly id = 'bitget';
  readonly name = 'Bitget Exchange';

  async fetchPrice(appSymbol: string, globalScanDeadlineMs?: number): Promise<NormalizedTicker> {
    const receivedAt = Date.now();
    let providerSymbol = appSymbol;
    let assetType: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN' = 'CRYPTO';

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

      const url = `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${encodeURIComponent(providerSymbol)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Bitget API rate limit exceeded (HTTP 429)');
      }

      if (!response.ok) {
        let msg = `Bitget API returned HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson && errJson.msg) msg = errJson.msg;
        } catch (_) {}
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, msg);
      }

      const json = (await response.json()) as BitgetTickerResponse;

      if (json.code !== '00000' || !Array.isArray(json.data) || json.data.length === 0) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, json.msg || `No ticker data found for symbol ${providerSymbol}`);
      }

      const raw = json.data[0];
      const price = parseFloat(raw.lastPr);
      const bid = raw.bidPr ? parseFloat(raw.bidPr) : null;
      const ask = raw.askPr ? parseFloat(raw.askPr) : null;
      const timestamp = parseInt(raw.ts, 10);

      // Validate Price & Timestamp
      if (isNaN(price) || !isFinite(price) || price <= 0) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Invalid price returned by Bitget: ${raw.lastPr}`);
      }

      if (isNaN(timestamp) || timestamp <= 0) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Invalid timestamp returned by Bitget: ${raw.ts}`);
      }

      const maxAgeMs = serverConfig.getConfig().marketDataMaxAgeMs;
      const isFresh = receivedAt - timestamp <= maxAgeMs;

      return {
        symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
        rawSymbol: providerSymbol,
        provider: this.id,
        assetType,
        bid: (bid !== null && !isNaN(bid) && bid > 0) ? bid : null,
        ask: (ask !== null && !isNaN(ask) && ask > 0) ? ask : null,
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
      return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Bitget connection failed: ${msg}`);
    }
  }

  private mapTimeframeToGranularity(timeframe: string): string | null {
    switch (timeframe.toLowerCase().trim()) {
      case '1m': case '1min': return '1min';
      case '3m': case '3min': return '3min';
      case '5m': case '5min': return '5min';
      case '15m': case '15min': return '15min';
      case '30m': case '30min': return '30min';
      case '1h': case '1hour': case '60m': return '1h';
      case '4h': case '4hour': return '4h';
      case '6h': case '6hour': return '6h';
      case '12h': case '12hour': return '12h';
      case '1d': case '1day': return '1day';
      case '1w': case '1week': return '1week';
      default: return null;
    }
  }

  private async fetchDirectCandles(
    appSymbol: string,
    providerSymbol: string,
    requestedTimeframe: string,
    granularity: string,
    limit: number,
    globalScanDeadlineMs?: number
  ): Promise<NormalizedCandle[]> {
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
      const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
      const url = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${encodeURIComponent(providerSymbol)}&granularity=${granularity}&limit=${safeLimit}`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson && errJson.msg) errorDetail = `${errorDetail}: ${errJson.msg}`;
        } catch (_) {}
        throw new Error(`Bitget candles API returned ${errorDetail}`);
      }

      const json = await response.json();
      if (json.code !== '00000' || !Array.isArray(json.data)) {
        throw new Error(json.msg || 'Failed to fetch candles from Bitget');
      }

      const candles: NormalizedCandle[] = [];
      for (const item of json.data) {
        if (Array.isArray(item) && item.length >= 6) {
          const ts = parseInt(item[0], 10);
          const open = parseFloat(item[1]);
          const high = parseFloat(item[2]);
          const low = parseFloat(item[3]);
          const close = parseFloat(item[4]);
          const volume = parseFloat(item[5]);

          if (!isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close) && open > 0) {
            candles.push({
              symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
              provider: this.id,
              timeframe: requestedTimeframe,
              open,
              high,
              low,
              close,
              volume: !isNaN(volume) ? volume : null,
              timestamp: ts,
            });
          }
        }
      }

      return candles;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async fetchCandles(appSymbol: string, timeframe: string = '1m', limit: number = 50, globalScanDeadlineMs?: number): Promise<NormalizedCandle[]> {
    const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
    const { providerSymbol } = mapping;

    const granularity = this.mapTimeframeToGranularity(timeframe);

    let directFetchError: string | null = null;
    // 1. Direct fetch if granularity mapped
    if (granularity) {
      try {
        const direct = await this.fetchDirectCandles(appSymbol, providerSymbol, timeframe, granularity, limit, globalScanDeadlineMs);
        if (direct && direct.length > 0) return direct;
      } catch (err) {
        directFetchError = String(err);
        const isNotAvailable = directFetchError.includes('does not exist') || directFetchError.includes('40034') || directFetchError.includes('HTTP 404');
        if (isNotAvailable) {
          logger.info(`Bitget direct fetch unavailable for '${timeframe}' on ${appSymbol} (symbol not listed on Bitget)`);
        } else {
          logger.warn(`Bitget direct fetch failed for '${timeframe}' (${granularity})`, { appSymbol, error: directFetchError });
        }
      }
    }

    // 2. Aggregate lower timeframe if unmapped or direct failed
    // Do not attempt lower-timeframe aggregation if the symbol does not exist on Bitget
    if (directFetchError && (directFetchError.includes('does not exist') || directFetchError.includes('40034') || directFetchError.includes('HTTP 404') || directFetchError.includes('HTTP 400'))) {
      logger.info(`Timeframe '${timeframe}' unavailable for ${appSymbol} on Bitget`);
      return [];
    }

    const lowerGranularity = '1min';
    try {
      const lowerLimit = Math.min(1000, limit * 60);
      const lowerCandles = await this.fetchDirectCandles(appSymbol, providerSymbol, '1m', lowerGranularity, lowerLimit, globalScanDeadlineMs);
      if (lowerCandles && lowerCandles.length > 0) {
        const aggregated = aggregateOHLCCandles(lowerCandles, timeframe, limit);
        if (aggregated && aggregated.length > 0) return aggregated;
      }
    } catch (err) {
      logger.warn(`Bitget lower-timeframe aggregation failed for '${timeframe}'`, { appSymbol, error: String(err) });
    }

    logger.info(`Timeframe '${timeframe}' unavailable for ${appSymbol} on Bitget`);
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const ticker = await this.fetchPrice('BTCUSDT');
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
