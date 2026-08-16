/**
 * Market Data Normalized Types & Interfaces
 * Used across MarketDataManager and Provider Adapters.
 */

export type AssetType = 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN';

export type MarketDataStatus = 'OK' | 'STALE' | 'MARKET_DATA_UNAVAILABLE';

export interface NormalizedTicker {
  symbol: string;             // Normalized application symbol e.g. "BTCUSDT"
  rawSymbol: string;          // Provider native symbol e.g. "BTCUSDT" or "BINANCE:BTCUSDT"
  provider: string;           // Provider ID e.g. "bitget", "finnhub", "twelvedata", "forex"
  assetType: AssetType;
  bid: number | null;         // Null if not supplied by provider
  ask: number | null;         // Null if not supplied by provider
  price: number;              // Validated positive number
  timestamp: number;          // Data timestamp from provider (ms)
  receivedAt: number;         // Server reception timestamp (ms)
  source: 'LIVE' | 'CACHE';
  isFresh: boolean;           // True if within max age threshold
  status: MarketDataStatus;
  errorMessage?: string;
}

export interface NormalizedCandle {
  symbol: string;
  provider: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  timestamp: number;
}

export interface ProviderHealth {
  provider: string;
  name: string;
  configured: boolean;
  status: 'CONNECTED' | 'UNAVAILABLE' | 'NOT VERIFIED';
  latencyMs?: number;
  lastChecked?: string;
  errorMessage?: string;
}

export interface MarketStatusResponse {
  timestamp: string;
  gate: string;
  providers: Record<string, ProviderHealth>;
  overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE';
}
