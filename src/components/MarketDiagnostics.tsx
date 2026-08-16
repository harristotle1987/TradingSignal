/**
 * Market Data Diagnostics Component (Gate 2)
 * Renders real market price data fetched directly from MarketDataManager.
 * Strictly presents verified real API response fields with zero fake or placeholder data.
 */

import { useState } from 'react';
import { NormalizedTicker } from '../types/index.js';
import { api } from '../api/client.js';
import { StatusBadge } from './StatusBadge.js';
import { Search, RefreshCw, AlertCircle, Database, Clock, Zap } from 'lucide-react';
import { formatTimeWithZone } from '../utils/time.js';

export function MarketDiagnostics() {
  const [symbolInput, setSymbolInput] = useState<string>('BTCUSDT');
  const [selectedProvider, setSelectedProvider] = useState<string>('auto');
  const [loading, setLoading] = useState<boolean>(false);
  const [tickerResult, setTickerResult] = useState<NormalizedTicker | null>(null);

  const handleTestFetch = async () => {
    if (!symbolInput.trim()) return;
    setLoading(true);

    try {
      const providerParam = selectedProvider === 'auto' ? undefined : selectedProvider;
      const result = await api.fetchMarketPrice(symbolInput.trim(), providerParam);
      setTickerResult(result);
    } catch (err) {
      console.error('Market diagnostics test failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            Market Data Diagnostics (Gate 2)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Test live price normalization and provider connection via MarketDataManager
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
          <span>Cache TTL: 5000ms</span>
          <span>&bull;</span>
          <span>Max Age: 60s</span>
        </div>
      </div>

      {/* Query Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-mono text-slate-400 mb-1">
            Symbol Name
          </label>
          <div className="relative">
            <input
              type="text"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              placeholder="e.g. BTCUSDT, EURUSD, AAPL"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-2.5" />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-mono text-slate-400 mb-1">
            Target Provider
          </label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
          >
            <option value="auto">Auto Select (MarketDataManager)</option>
            <option value="bitget">Bitget Exchange</option>
            <option value="finnhub">Finnhub Market Data</option>
            <option value="twelvedata">Twelve Data (Forex)</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={handleTestFetch}
            disabled={loading || !symbolInput.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Fetch Real Price</span>
          </button>
        </div>
      </div>

      {/* Live Result Output */}
      {tickerResult && (
        <div className="mt-4 bg-slate-950 border border-slate-800 rounded-lg p-5 text-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold text-white bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
                {tickerResult.symbol}
              </span>
              <span className="text-slate-400 font-mono text-[11px]">
                Raw: {tickerResult.rawSymbol}
              </span>
              <span className="text-slate-400 font-mono text-[11px] uppercase bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                {tickerResult.provider}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge
                status={tickerResult.status === 'OK' ? 'ok' : 'error'}
                label={tickerResult.status}
              />
              <span className="font-mono text-[11px] text-slate-400 bg-slate-900 px-2 py-1 rounded border border-slate-800 flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                Source: {tickerResult.source}
              </span>
            </div>
          </div>

          {tickerResult.status === 'MARKET_DATA_UNAVAILABLE' ? (
            <div className="p-4 bg-amber-950/40 border border-amber-900/60 rounded-lg text-amber-200 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span>MARKET_DATA_UNAVAILABLE</span>
              </div>
              <p className="text-xs text-amber-300/80 font-mono pl-6">
                {tickerResult.errorMessage || 'Provider failed or unavailable for this symbol'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block">LAST PRICE</span>
                <span className="text-sm font-bold text-emerald-400">
                  {tickerResult.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </span>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block">BID / ASK</span>
                <span className="text-xs text-slate-200">
                  {tickerResult.bid ? tickerResult.bid : 'N/A'} / {tickerResult.ask ? tickerResult.ask : 'N/A'}
                </span>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block">DATA TIMESTAMP</span>
                <span className="text-xs text-slate-200 flex items-center gap-1 font-mono">
                  <Clock className="w-3 h-3 text-slate-400" />
                  {tickerResult.timestamp ? formatTimeWithZone(tickerResult.timestamp, 'LOCAL') : 'N/A'}
                </span>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block">FRESHNESS</span>
                <span className={`text-xs font-semibold ${tickerResult.isFresh ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {tickerResult.isFresh ? 'FRESH (<60s)' : 'STALE (>60s)'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
