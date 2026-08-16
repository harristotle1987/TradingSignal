/**
 * Interface for Market Data Provider Adapters
 */

import { NormalizedTicker, NormalizedCandle, ProviderHealth } from '../types.js';

export interface IMarketDataProvider {
  readonly id: string;
  readonly name: string;

  /**
   * Fetches the current ticker price for a given normalized application symbol.
   */
  fetchPrice(appSymbol: string): Promise<NormalizedTicker>;

  /**
   * Fetches candles/OHLCV data if supported by provider.
   */
  fetchCandles?(appSymbol: string, timeframe: string, limit: number): Promise<NormalizedCandle[]>;

  /**
   * Checks if provider is configured and responding to real API requests.
   */
  healthCheck(): Promise<ProviderHealth>;
}
