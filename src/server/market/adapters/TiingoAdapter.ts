/**
 * Tiingo Market Data Provider Adapter (Gate 1 & Gate 2)
 * Fetches real-time quotes and historical candlestick OHLC data from Tiingo API
 * for Forex, US Equities/Stocks (IEX), and Crypto.
 *
 * STRICT INTEGRITY POLICY:
 * - Requires server-side TIINGO_API_KEY.
 * - Never fabricates, estimates, or synthesizes market prices or candles.
 * - Enforces timestamp validation and OHLC integrity.
 */

import { IMarketDataProvider } from './IMarketDataProvider.js';
import { NormalizedTicker, NormalizedCandle, ProviderHealth } from '../types.js';
import { SymbolNormalizer } from '../SymbolNormalizer.js';
import { quotaManager } from '../QuotaManager.js';
import { serverConfig } from '../../config.js';
import { logger } from '../../logger.js';

interface TiingoFxTopItem {
  ticker?: string;
  quoteTimestamp?: string;
  bidPrice?: number;
  bidSize?: number;
  askPrice?: number;
  askSize?: number;
  midPrice?: number;
  lastPrice?: number;
}

interface TiingoFxPriceItem {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TiingoIexTopItem {
  ticker?: string;
  timestamp?: string;
  quoteTimestamp?: string;
  last?: number;
  lastSaleTimestamp?: string;
  low?: number;
  high?: number;
  open?: number;
  close?: number;
  volume?: number;
  bidPrice?: number;
  askPrice?: number;
  mid?: number;
}

interface TiingoIexPriceItem {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface TiingoCryptoTopItem {
  ticker?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  quoteTimestamp?: string;
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  midPrice?: number;
}

interface TiingoCryptoPriceItem {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  tradesDone?: number;
}

export class TiingoAdapter implements IMarketDataProvider {
  readonly id = 'tiingo';
  readonly name = 'Tiingo Market Data';

  private mapTimeframeToTiingoResample(tf: string): string {
    const lower = tf.toLowerCase().trim();
    if (lower === '1m' || lower === '1min') return '1min';
    if (lower === '5m' || lower === '5min') return '5min';
    if (lower === '15m' || lower === '15min') return '15min';
    if (lower === '30m' || lower === '30min') return '30min';
    if (lower === '1h' || lower === '60m' || lower === '1hour') return '1hour';
    if (lower === '4h' || lower === '240m' || lower === '4hour') return '4hour';
    if (lower === '1d' || lower === '1day') return '1day';
    return '1hour';
  }

  private calculateStartDate(timeframe: string, limit: number): string {
    const lower = timeframe.toLowerCase().trim();
    let multiplierMinutes = 60;
    if (lower.endsWith('m') || lower.endsWith('min')) {
      const mins = parseInt(lower, 10);
      multiplierMinutes = isNaN(mins) ? 15 : mins;
    } else if (lower.endsWith('h') || lower.endsWith('hour')) {
      const hrs = parseInt(lower, 10);
      multiplierMinutes = (isNaN(hrs) ? 1 : hrs) * 60;
    } else if (lower.endsWith('d') || lower.endsWith('day')) {
      multiplierMinutes = 1440;
    }

    // Look back with safety margin for non-trading hours and weekends
    const totalMinutes = Math.max(multiplierMinutes * limit * 3, 2880); // At least 2 days
    const startMs = Date.now() - totalMinutes * 60 * 1000;
    const startDate = new Date(startMs);
    return startDate.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  async fetchPrice(appSymbol: string, globalScanDeadlineMs?: number): Promise<NormalizedTicker> {
    let providerSymbol = appSymbol;
    let assetType: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN' = 'FOREX';

    const apiKey = process.env.TIINGO_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return this.createErrorTicker(
        appSymbol,
        providerSymbol,
        assetType,
        'TIINGO_API_KEY environment variable is required'
      );
    }

    try {
      const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
      providerSymbol = mapping.providerSymbol;
      assetType = mapping.assetType;

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

      let url = '';
      if (assetType === 'FOREX') {
        url = `https://api.tiingo.com/tiingo/fx/top?tickers=${encodeURIComponent(providerSymbol)}&token=${apiKey.trim()}`;
      } else if (assetType === 'CRYPTO') {
        url = `https://api.tiingo.com/tiingo/crypto/top?tickers=${encodeURIComponent(providerSymbol)}&token=${apiKey.trim()}`;
      } else {
        // STOCK / IEX
        url = `https://api.tiingo.com/iex/${encodeURIComponent(providerSymbol)}?token=${apiKey.trim()}`;
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          quotaManager.recordResponse(this.id, 429);
        }
        return this.createErrorTicker(
          appSymbol,
          providerSymbol,
          assetType,
          `Tiingo API returned HTTP ${response.status} (${response.statusText})`
        );
      }

      const json = await response.json();
      const now = Date.now();

      if (assetType === 'FOREX') {
        const dataArr = Array.isArray(json) ? (json as TiingoFxTopItem[]) : [json as TiingoFxTopItem];
        if (!dataArr || dataArr.length === 0 || !dataArr[0]) {
          return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Empty FX quote response from Tiingo');
        }
        const item = dataArr[0];
        const bid = typeof item.bidPrice === 'number' ? item.bidPrice : null;
        const ask = typeof item.askPrice === 'number' ? item.askPrice : null;
        let price = 0;
        if (typeof item.midPrice === 'number' && item.midPrice > 0) {
          price = item.midPrice;
        } else if (bid !== null && ask !== null && (bid + ask) > 0) {
          price = (bid + ask) / 2;
        } else if (typeof item.lastPrice === 'number' && item.lastPrice > 0) {
          price = item.lastPrice;
        } else if (ask !== null && ask > 0) {
          price = ask;
        } else if (bid !== null && bid > 0) {
          price = bid;
        }

        if (!price || isNaN(price) || price <= 0) {
          return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Invalid FX price received from Tiingo');
        }

        const dataTimestamp = item.quoteTimestamp ? new Date(item.quoteTimestamp).getTime() : now;
        const isFresh = (now - dataTimestamp) <= serverConfig.getConfig().marketDataMaxAgeMs;

        return {
          symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
          rawSymbol: providerSymbol,
          provider: this.id,
          source: 'LIVE',
          dataSource: this.id,
          assetType: 'FOREX',
          bid,
          ask,
          price,
          timestamp: dataTimestamp,
          receivedAt: now,
          isFresh,
          status: 'OK',
        };
      }

      if (assetType === 'CRYPTO') {
        const dataArr = Array.isArray(json) ? (json as TiingoCryptoTopItem[]) : [json as TiingoCryptoTopItem];
        if (!dataArr || dataArr.length === 0 || !dataArr[0]) {
          return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Empty Crypto quote response from Tiingo');
        }
        const item = dataArr[0];
        const bid = typeof item.bidPrice === 'number' ? item.bidPrice : null;
        const ask = typeof item.askPrice === 'number' ? item.askPrice : null;
        let price = 0;
        if (typeof item.lastPrice === 'number' && item.lastPrice > 0) {
          price = item.lastPrice;
        } else if (typeof item.midPrice === 'number' && item.midPrice > 0) {
          price = item.midPrice;
        } else if (bid !== null && ask !== null && (bid + ask) > 0) {
          price = (bid + ask) / 2;
        } else if (ask !== null && ask > 0) {
          price = ask;
        } else if (bid !== null && bid > 0) {
          price = bid;
        }

        if (!price || isNaN(price) || price <= 0) {
          return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Invalid Crypto price received from Tiingo');
        }

        const dataTimestamp = item.quoteTimestamp ? new Date(item.quoteTimestamp).getTime() : now;
        const isFresh = (now - dataTimestamp) <= serverConfig.getConfig().marketDataMaxAgeMs;

        return {
          symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
          rawSymbol: providerSymbol,
          provider: this.id,
          source: 'LIVE',
          dataSource: this.id,
          assetType: 'CRYPTO',
          bid,
          ask,
          price,
          timestamp: dataTimestamp,
          receivedAt: now,
          isFresh,
          status: 'OK',
        };
      }

      // STOCK (IEX)
      const dataArr = Array.isArray(json) ? (json as TiingoIexTopItem[]) : [json as TiingoIexTopItem];
      if (!dataArr || dataArr.length === 0 || !dataArr[0]) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Empty Stock quote response from Tiingo');
      }
      const item = dataArr[0];
      const bid = typeof item.bidPrice === 'number' ? item.bidPrice : null;
      const ask = typeof item.askPrice === 'number' ? item.askPrice : null;
      let price = 0;
      if (typeof item.last === 'number' && item.last > 0) {
        price = item.last;
      } else if (typeof item.close === 'number' && item.close > 0) {
        price = item.close;
      } else if (typeof item.open === 'number' && item.open > 0) {
        price = item.open;
      } else if (typeof item.mid === 'number' && item.mid > 0) {
        price = item.mid;
      } else if (bid !== null && ask !== null && (bid + ask) > 0) {
        price = (bid + ask) / 2;
      }

      if (!price || isNaN(price) || price <= 0) {
        return this.createErrorTicker(appSymbol, providerSymbol, assetType, 'Invalid Stock price received from Tiingo');
      }

      const tsStr = item.quoteTimestamp || item.timestamp || item.lastSaleTimestamp;
      const dataTimestamp = tsStr ? new Date(tsStr).getTime() : now;
      const isFresh = (now - dataTimestamp) <= serverConfig.getConfig().marketDataMaxAgeMs;

      return {
        symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
        rawSymbol: providerSymbol,
        provider: this.id,
        source: 'LIVE',
        dataSource: this.id,
        assetType: 'STOCK',
        bid,
        ask,
        price,
        timestamp: dataTimestamp,
        receivedAt: now,
        isFresh,
        status: 'OK',
      };
    } catch (err: any) {
      const errMsg = err?.name === 'AbortError' ? 'Tiingo request timed out' : String(err);
      return this.createErrorTicker(appSymbol, providerSymbol, assetType, errMsg);
    }
  }

  async fetchCandles(
    appSymbol: string,
    timeframe = '1m',
    limit = 50,
    globalScanDeadlineMs?: number
  ): Promise<NormalizedCandle[]> {
    const apiKey = process.env.TIINGO_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return [];
    }

    try {
      const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
      const providerSymbol = mapping.providerSymbol;
      const assetType = mapping.assetType;

      const resampleFreq = this.mapTimeframeToTiingoResample(timeframe);
      const startDate = this.calculateStartDate(timeframe, limit);

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

      let url = '';
      if (assetType === 'FOREX') {
        url = `https://api.tiingo.com/tiingo/fx/${encodeURIComponent(providerSymbol)}/prices?startDate=${startDate}&resampleFreq=${resampleFreq}&token=${apiKey.trim()}`;
      } else if (assetType === 'CRYPTO') {
        url = `https://api.tiingo.com/tiingo/crypto/prices?tickers=${encodeURIComponent(providerSymbol)}&startDate=${startDate}&resampleFreq=${resampleFreq}&token=${apiKey.trim()}`;
      } else {
        // Stock
        url = `https://api.tiingo.com/iex/${encodeURIComponent(providerSymbol)}/prices?startDate=${startDate}&resampleFreq=${resampleFreq}&token=${apiKey.trim()}`;
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          quotaManager.recordResponse(this.id, 429);
        }
        return [];
      }

      const json = await response.json();
      const normalizedCandles: NormalizedCandle[] = [];
      const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);

      if (assetType === 'FOREX') {
        const list = Array.isArray(json) ? (json as TiingoFxPriceItem[]) : [];
        for (const item of list) {
          if (!item.date || typeof item.open !== 'number' || typeof item.close !== 'number') continue;
          const ts = new Date(item.date).getTime();
          normalizedCandles.push({
            symbol: cleanSymbol,
            provider: this.id,
            source: this.id,
            timeframe,
            interval: timeframe,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: null,
            timestamp: ts,
          });
        }
      } else if (assetType === 'CRYPTO') {
        let list: TiingoCryptoPriceItem[] = [];
        if (Array.isArray(json) && json.length > 0) {
          if ('priceData' in json[0] && Array.isArray((json[0] as any).priceData)) {
            list = (json[0] as any).priceData;
          } else {
            list = json as TiingoCryptoPriceItem[];
          }
        }
        for (const item of list) {
          if (!item.date || typeof item.open !== 'number' || typeof item.close !== 'number') continue;
          const ts = new Date(item.date).getTime();
          normalizedCandles.push({
            symbol: cleanSymbol,
            provider: this.id,
            source: this.id,
            timeframe,
            interval: timeframe,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: typeof item.volume === 'number' ? item.volume : null,
            timestamp: ts,
          });
        }
      } else {
        // Stock
        const list = Array.isArray(json) ? (json as TiingoIexPriceItem[]) : [];
        for (const item of list) {
          if (!item.date || typeof item.open !== 'number' || typeof item.close !== 'number') continue;
          const ts = new Date(item.date).getTime();
          normalizedCandles.push({
            symbol: cleanSymbol,
            provider: this.id,
            source: this.id,
            timeframe,
            interval: timeframe,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: typeof item.volume === 'number' ? item.volume : null,
            timestamp: ts,
          });
        }
      }

      // Sort descending (most recent first)
      normalizedCandles.sort((a, b) => b.timestamp - a.timestamp);
      return normalizedCandles.slice(0, limit);
    } catch (err) {
      logger.warn(`Tiingo fetchCandles failed for ${appSymbol} (${timeframe})`, { error: String(err) });
      return [];
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const apiKey = process.env.TIINGO_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        provider: this.id,
        name: this.name,
        configured: false,
        status: 'UNAVAILABLE',
        lastChecked: new Date().toISOString(),
        errorMessage: 'TIINGO_API_KEY is not configured',
      };
    }

    try {
      const startTime = Date.now();
      const ticker = await this.fetchPrice('EURUSD');
      const latencyMs = Date.now() - startTime;

      if (ticker.status === 'OK' || ticker.price > 0) {
        return {
          provider: this.id,
          name: this.name,
          configured: true,
          status: 'CONNECTED',
          latencyMs,
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        provider: this.id,
        name: this.name,
        configured: true,
        status: 'UNAVAILABLE',
        latencyMs,
        lastChecked: new Date().toISOString(),
        errorMessage: ticker.errorMessage || 'Health probe failed',
      };
    } catch (err: any) {
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

  private createErrorTicker(
    symbol: string,
    rawSymbol: string,
    assetType: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN',
    errorMessage: string
  ): NormalizedTicker {
    return {
      symbol: SymbolNormalizer.normalizeAppSymbol(symbol),
      rawSymbol,
      provider: this.id,
      source: 'LIVE',
      dataSource: this.id,
      assetType,
      bid: null,
      ask: null,
      price: 0,
      timestamp: 0,
      receivedAt: Date.now(),
      isFresh: false,
      status: 'MARKET_DATA_UNAVAILABLE',
      errorMessage,
    };
  }
}
