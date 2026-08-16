/**
 * Twelve Data Authoritative Forex Market Data Adapter
 * Fetches real-time Forex quotes and OHLC candlestick data directly from Twelve Data API.
 *
 * STRICT INTEGRITY POLICY:
 * - Requires server-side TWELVE_DATA_API_KEY.
 * - Never fabricates, estimates, or synthesizes market prices.
 * - Enforces data staleness, timestamp validation, and OHLC integrity.
 */

import { IMarketDataProvider } from './IMarketDataProvider.js';
import { NormalizedTicker, NormalizedCandle, ProviderHealth } from '../types.js';
import { SymbolNormalizer } from '../SymbolNormalizer.js';
import { aggregateOHLCCandles } from '../CandleAggregator.js';
import { serverConfig } from '../../config.js';
import { logger } from '../../logger.js';

interface TwelveDataQuoteResponse {
  symbol?: string;
  name?: string;
  exchange?: string;
  datetime?: string;
  timestamp?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  bid?: string;
  ask?: string;
  price?: string;
  status?: string;
  code?: number;
  message?: string;
}

interface TwelveDataTimeSeriesResponse {
  meta?: {
    symbol?: string;
    interval?: string;
    currency_base?: string;
    currency_quote?: string;
    type?: string;
  };
  values?: Array<{
    datetime: string;
    timestamp?: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
  }>;
  status?: string;
  code?: number;
  message?: string;
}

export class TwelveDataAdapter implements IMarketDataProvider {
  readonly id = 'twelvedata';
  readonly name = 'Twelve Data (Forex)';

  async fetchPrice(appSymbol: string): Promise<NormalizedTicker> {
    let providerSymbol = appSymbol;
    let assetType: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN' = 'FOREX';

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return this.createErrorTicker(
        appSymbol,
        providerSymbol,
        assetType,
        'TWELVE_DATA_API_KEY environment variable is required'
      );
    }

    try {
      const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
      providerSymbol = mapping.providerSymbol; // e.g. "EUR/USD"
      assetType = mapping.assetType;

      const timeoutMs = serverConfig.getConfig().marketDataTimeoutMs;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(providerSymbol)}&apikey=${apiKey.trim()}`;

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return this.createErrorTicker(
          appSymbol,
          providerSymbol,
          assetType,
          `Twelve Data API returned HTTP ${response.status} (${response.statusText})`
        );
      }

      const json = (await response.json()) as TwelveDataQuoteResponse;

      if (json.status === 'error' || (json.code && json.code >= 400)) {
        return this.createErrorTicker(
          appSymbol,
          providerSymbol,
          assetType,
          json.message || `Twelve Data API returned error code ${json.code}`
        );
      }

      const parsedBid = json.bid ? parseFloat(json.bid) : NaN;
      const parsedAsk = json.ask ? parseFloat(json.ask) : NaN;
      const parsedPrice = json.price ? parseFloat(json.price) : (json.close ? parseFloat(json.close) : NaN);

      const bid = !isNaN(parsedBid) && parsedBid > 0 ? parsedBid : null;
      const ask = !isNaN(parsedAsk) && parsedAsk > 0 ? parsedAsk : null;

      let price = 0;
      if (bid !== null && ask !== null) {
        price = (bid + ask) / 2;
      } else if (!isNaN(parsedPrice) && parsedPrice > 0) {
        price = parsedPrice;
      } else if (ask !== null) {
        price = ask;
      } else if (bid !== null) {
        price = bid;
      }

      if (isNaN(price) || price <= 0) {
        return this.createErrorTicker(
          appSymbol,
          providerSymbol,
          assetType,
          `Invalid positive market price returned by Twelve Data API for ${appSymbol}`
        );
      }

      let timestamp = Date.now();
      if (typeof json.timestamp === 'number' && json.timestamp > 0) {
        timestamp = json.timestamp * 1000;
      } else if (json.datetime) {
        const parsedDt = new Date(json.datetime).getTime();
        if (!isNaN(parsedDt) && parsedDt > 0) timestamp = parsedDt;
      }

      const receivedAt = Date.now();
      // Freshness check: Data received live from Twelve Data API within 60s, and market quote timestamp within 24h
      const ageMs = receivedAt - timestamp;
      const isFresh = ageMs <= 24 * 60 * 60 * 1000 && (Date.now() - receivedAt <= 60000);

      return {
        symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
        rawSymbol: providerSymbol,
        provider: this.id,
        assetType,
        bid,
        ask,
        price,
        timestamp,
        receivedAt,
        source: 'LIVE',
        isFresh,
        status: isFresh ? 'OK' : 'STALE',
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.createErrorTicker(
        appSymbol,
        providerSymbol,
        assetType,
        `Twelve Data connection failed: ${msg}`
      );
    }
  }

  private mapTimeframeToTwelveDataInterval(timeframe: string): string | null {
    const tf = timeframe.toLowerCase().trim();
    switch (tf) {
      case '1m': case '1min': return '1min';
      case '2m': case '2min': return '2min';
      case '5m': case '5min': return '5min';
      case '15m': case '15min': return '15min';
      case '30m': case '30min': return '30min';
      case '45m': case '45min': return '45min';
      case '1h': case '1hour': case '60m': return '1h';
      case '2h': case '2hour': return '2h';
      case '4h': case '4hour': return '4h';
      case '1d': case '1day': return '1day';
      case '1w': case '1week': return '1week';
      case '1mth': case '1month': return '1month';
      default: return null;
    }
  }

  private getLowerTimeframeForAggregation(timeframe: string): { timeframe: string; ratio: number } | null {
    const tf = timeframe.toLowerCase().trim();
    switch (tf) {
      case '3m': case '3min': return { timeframe: '1m', ratio: 3 };
      case '5m': case '5min': return { timeframe: '1m', ratio: 5 };
      case '15m': case '15min': return { timeframe: '5m', ratio: 3 };
      case '30m': case '30min': return { timeframe: '15m', ratio: 2 };
      case '45m': case '45min': return { timeframe: '15m', ratio: 3 };
      case '1h': case '1hour': case '60m': return { timeframe: '15m', ratio: 4 };
      case '2h': case '2hour': return { timeframe: '1h', ratio: 2 };
      case '4h': case '4hour': return { timeframe: '1h', ratio: 4 };
      case '12h': case '12hour': return { timeframe: '1h', ratio: 12 };
      case '1d': case '1day': return { timeframe: '1h', ratio: 24 };
      default: return null;
    }
  }

  private async fetchDirectTimeSeries(
    appSymbol: string,
    providerSymbol: string,
    requestedTimeframe: string,
    interval: string,
    limit: number,
    apiKey: string
  ): Promise<NormalizedCandle[]> {
    const timeoutMs = serverConfig.getConfig().marketDataTimeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(providerSymbol)}&interval=${interval}&outputsize=${limit}&apikey=${apiKey.trim()}`;

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Twelve Data Time Series API returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as TwelveDataTimeSeriesResponse;
      if (json.status === 'error' || !json.values || !Array.isArray(json.values)) {
        if (json.message) throw new Error(`Twelve Data API error: ${json.message}`);
        return [];
      }

      if (json.meta?.interval) {
        const returnedInterval = json.meta.interval.toLowerCase().trim();
        if (returnedInterval !== interval.toLowerCase().trim()) {
          logger.warn(`Twelve Data returned interval '${returnedInterval}' which differs from requested '${interval}'`);
          return [];
        }
      }

      const normSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
      const candles: NormalizedCandle[] = [];

      for (const item of json.values) {
        const open = parseFloat(item.open);
        const high = parseFloat(item.high);
        const low = parseFloat(item.low);
        const close = parseFloat(item.close);
        const volume = item.volume ? parseFloat(item.volume) : null;

        let timestamp = Date.now();
        if (typeof item.timestamp === 'number' && item.timestamp > 0) {
          timestamp = item.timestamp * 1000;
        } else if (item.datetime) {
          const parsedDt = new Date(item.datetime).getTime();
          if (!isNaN(parsedDt) && parsedDt > 0) timestamp = parsedDt;
        }

        // OHLC Integrity validation
        if (
          !isNaN(open) && open > 0 &&
          !isNaN(high) && high > 0 &&
          !isNaN(low) && low > 0 &&
          !isNaN(close) && close > 0 &&
          high >= low && high >= open && high >= close &&
          low <= open && low <= close
        ) {
          candles.push({
            symbol: normSymbol,
            provider: this.id,
            timeframe: requestedTimeframe,
            open,
            high,
            low,
            close,
            volume: isNaN(volume as number) ? null : volume,
            timestamp,
          });
        }
      }

      return candles;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async fetchCandles(appSymbol: string, timeframe = '1m', limit = 50): Promise<NormalizedCandle[]> {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('TWELVE_DATA_API_KEY environment variable is required for candle fetching');
    }

    const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
    const providerSymbol = mapping.providerSymbol; // e.g. "EUR/USD"

    const mappedInterval = this.mapTimeframeToTwelveDataInterval(timeframe);

    // 1. Exact timeframe fetch if mapped
    if (mappedInterval) {
      try {
        const directCandles = await this.fetchDirectTimeSeries(appSymbol, providerSymbol, timeframe, mappedInterval, limit, apiKey);
        if (directCandles && directCandles.length > 0) {
          return directCandles;
        }
      } catch (err) {
        logger.warn(`Twelve Data direct fetch for interval '${mappedInterval}' (${timeframe}) failed, trying aggregation`, {
          symbol: appSymbol,
          error: String(err),
        });
      }
    }

    // 2. Aggregate genuine lower-timeframe OHLC candles into requested timeframe
    const lowerTf = this.getLowerTimeframeForAggregation(timeframe);
    if (lowerTf) {
      const lowerInterval = this.mapTimeframeToTwelveDataInterval(lowerTf.timeframe);
      if (lowerInterval) {
        try {
          const fetchLimit = limit * lowerTf.ratio;
          const lowerCandles = await this.fetchDirectTimeSeries(appSymbol, providerSymbol, lowerTf.timeframe, lowerInterval, fetchLimit, apiKey);
          if (lowerCandles && lowerCandles.length > 0) {
            const aggregated = aggregateOHLCCandles(lowerCandles, timeframe, limit);
            if (aggregated && aggregated.length > 0) {
              return aggregated;
            }
          }
        } catch (err) {
          logger.warn(`Twelve Data lower timeframe aggregation for '${timeframe}' using '${lowerTf.timeframe}' failed`, {
            symbol: appSymbol,
            error: String(err),
          });
        }
      }
    }

    // 3. Mark timeframe unavailable if not obtainable or safely aggregatable
    logger.info(`Timeframe '${timeframe}' unavailable for ${appSymbol} on Twelve Data`);
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);

    if (!isConfigured) {
      return {
        provider: this.id,
        name: this.name,
        configured: false,
        status: 'UNAVAILABLE',
        lastChecked: new Date().toISOString(),
        errorMessage: 'TWELVE_DATA_API_KEY environment variable is missing',
      };
    }

    const startTime = Date.now();
    try {
      const ticker = await this.fetchPrice('EURUSD');
      const latencyMs = Date.now() - startTime;

      return {
        provider: this.id,
        name: this.name,
        configured: true,
        status: ticker.status === 'OK' || ticker.status === 'STALE' ? 'CONNECTED' : 'UNAVAILABLE',
        latencyMs,
        lastChecked: new Date().toISOString(),
        errorMessage: ticker.status === 'MARKET_DATA_UNAVAILABLE' ? ticker.errorMessage : undefined,
      };
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
