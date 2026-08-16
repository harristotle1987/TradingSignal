/**
 * Asset-Class Specific Signal Scanner Component
 *
 * Provides dedicated category-separated scanning across:
 * - CRYPTO (Bitget / Spot & Perpetual, 24/7)
 * - FOREX (Twelve Data / Interbank sessions, 24/5)
 * - STOCKS (Finnhub / NYSE & NASDAQ, Exchange hours)
 *
 * Scans only the chosen symbol on demand when the user clicks SCAN.
 * Does not generate synthetic or placeholder signals.
 */

import { useState, useMemo } from 'react';
import {
  TradingSignal,
  NormalizedTicker,
  SignalGenerationResponse,
} from '../types/index.js';
import { formatTimeWithZone, DisplayTimeZone } from '../utils/time.js';
import {
  Search,
  TrendingUp,
  TrendingDown,
  Clock,
  ShieldCheck,
  Zap,
  CheckCircle2,
  AlertCircle,
  Activity,
  Layers,
  ChevronRight,
  Sparkles,
  Lock,
  ArrowUpRight,
  Database,
  Coins,
  Globe2,
  LineChart,
} from 'lucide-react';

export type AssetCategory = 'CRYPTO' | 'FOREX' | 'STOCKS';

export interface CategorySymbolInfo {
  symbol: string;
  name: string;
  category: AssetCategory;
  provider: string;
  exchange: string;
  sessionNote: string;
}

export const ASSET_CATEGORIES: Record<
  AssetCategory,
  {
    label: string;
    description: string;
    badge: string;
    icon: typeof Coins;
    symbols: CategorySymbolInfo[];
  }
> = {
  CRYPTO: {
    label: 'CRYPTO',
    description: 'Continuous 24/7 Spot & Perpetual Liquidity',
    badge: '24/7 LIVE',
    icon: Coins,
    symbols: [
      { symbol: 'BTCUSDT', name: 'Bitcoin (BTC/USDT)', category: 'CRYPTO', provider: 'Bitget', exchange: 'Global Spot', sessionNote: '24/7 Continuous' },
      { symbol: 'ETHUSDT', name: 'Ethereum (ETH/USDT)', category: 'CRYPTO', provider: 'Bitget', exchange: 'Global Spot', sessionNote: '24/7 Continuous' },
      { symbol: 'SOLUSDT', name: 'Solana (SOL/USDT)', category: 'CRYPTO', provider: 'Bitget', exchange: 'Global Spot', sessionNote: '24/7 Continuous' },
      { symbol: 'BNBUSDT', name: 'BNB (BNB/USDT)', category: 'CRYPTO', provider: 'Bitget', exchange: 'Global Spot', sessionNote: '24/7 Continuous' },
      { symbol: 'XRPUSDT', name: 'XRP (XRP/USDT)', category: 'CRYPTO', provider: 'Bitget', exchange: 'Global Spot', sessionNote: '24/7 Continuous' },
      { symbol: 'DOGEUSDT', name: 'Dogecoin (DOGE/USDT)', category: 'CRYPTO', provider: 'Bitget', exchange: 'Global Spot', sessionNote: '24/7 Continuous' },
    ],
  },
  FOREX: {
    label: 'FOREX',
    description: 'Major & Cross FX Pairs • 24/5 Interbank Liquidity',
    badge: '24/5 SESSIONS',
    icon: Globe2,
    symbols: [
      { symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'FOREX', provider: 'Twelve Data', exchange: 'London / NY', sessionNote: 'Sun 5PM - Fri 5PM ET' },
      { symbol: 'GBPUSD', name: 'British Pound / US Dollar', category: 'FOREX', provider: 'Twelve Data', exchange: 'London / NY', sessionNote: 'Sun 5PM - Fri 5PM ET' },
      { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', category: 'FOREX', provider: 'Twelve Data', exchange: 'Tokyo / NY', sessionNote: 'Sun 5PM - Fri 5PM ET' },
      { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', category: 'FOREX', provider: 'Twelve Data', exchange: 'Sydney / NY', sessionNote: 'Sun 5PM - Fri 5PM ET' },
      { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', category: 'FOREX', provider: 'Twelve Data', exchange: 'New York', sessionNote: 'Sun 5PM - Fri 5PM ET' },
      { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', category: 'FOREX', provider: 'Twelve Data', exchange: 'Zurich / NY', sessionNote: 'Sun 5PM - Fri 5PM ET' },
    ],
  },
  STOCKS: {
    label: 'STOCKS',
    description: 'US Equities & Megacaps • NYSE & NASDAQ Calendar',
    badge: 'NYSE / NASDAQ',
    icon: LineChart,
    symbols: [
      { symbol: 'AAPL', name: 'Apple Inc.', category: 'STOCKS', provider: 'Finnhub', exchange: 'NASDAQ', sessionNote: 'Mon-Fri 9:30 AM - 4:00 PM ET' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', category: 'STOCKS', provider: 'Finnhub', exchange: 'NASDAQ', sessionNote: 'Mon-Fri 9:30 AM - 4:00 PM ET' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', category: 'STOCKS', provider: 'Finnhub', exchange: 'NASDAQ', sessionNote: 'Mon-Fri 9:30 AM - 4:00 PM ET' },
      { symbol: 'TSLA', name: 'Tesla Inc.', category: 'STOCKS', provider: 'Finnhub', exchange: 'NASDAQ', sessionNote: 'Mon-Fri 9:30 AM - 4:00 PM ET' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', category: 'STOCKS', provider: 'Finnhub', exchange: 'NASDAQ', sessionNote: 'Mon-Fri 9:30 AM - 4:00 PM ET' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', category: 'STOCKS', provider: 'Finnhub', exchange: 'NASDAQ', sessionNote: 'Mon-Fri 9:30 AM - 4:00 PM ET' },
    ],
  },
};

interface AssetClassScannerProps {
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onScan: () => Promise<void>;
  isScanning: boolean;
  scanResult: SignalGenerationResponse | null;
  ticker: NormalizedTicker | null;
  isFetchingPrice: boolean;
  sessionState?: 'MARKET_OPEN' | 'MARKET_CLOSED' | 'OUTSIDE_TRADING_SESSION';
  preferredTimeZone: DisplayTimeZone;
}

export function AssetClassScanner({
  selectedSymbol,
  onSelectSymbol,
  onScan,
  isScanning,
  scanResult,
  ticker,
  isFetchingPrice,
  sessionState = 'MARKET_OPEN',
  preferredTimeZone,
}: AssetClassScannerProps) {
  // Infer active category from the selected symbol
  const activeCategory: AssetCategory = useMemo(() => {
    for (const [cat, data] of Object.entries(ASSET_CATEGORIES)) {
      if (data.symbols.some((s) => s.symbol === selectedSymbol)) {
        return cat as AssetCategory;
      }
    }
    return 'CRYPTO';
  }, [selectedSymbol]);

  const handleCategoryChange = (category: AssetCategory) => {
    const firstSym = ASSET_CATEGORIES[category].symbols[0].symbol;
    onSelectSymbol(firstSym);
  };

  const currentCategoryData = ASSET_CATEGORIES[activeCategory];
  const currentSymbolInfo = currentCategoryData.symbols.find((s) => s.symbol === selectedSymbol) || currentCategoryData.symbols[0];

  const isMarketClosed = sessionState !== 'MARKET_OPEN';
  const precision = ticker && ticker.price < 10 ? 5 : 2;

  // Active scanned signal (if present from multi-asset scan)
  const scannedSignal: TradingSignal | null =
    scanResult && scanResult.signal
      ? scanResult.signal
      : null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-5">
      {/* Scanner Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/80 flex items-center justify-center text-emerald-400">
            <Search className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white tracking-wide uppercase">SIGNAL SCANNER</h2>
              <span className="text-[10px] font-mono font-medium bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">
                ON-DEMAND ASSET SCAN
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Select an asset class and instrument to initiate multi-timeframe quality validation.
            </p>
          </div>
        </div>

        {/* Category Badge Indicator */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            Source: <strong className="text-white">{currentSymbolInfo.provider}</strong>
          </span>
        </div>
      </div>

      {/* 3 Clearly Separated Trade Categories: CRYPTO | FOREX | STOCKS */}
      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 block">
          1. Select Trade Category
        </label>
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {(['CRYPTO', 'FOREX', 'STOCKS'] as AssetCategory[]).map((category) => {
            const isSelected = activeCategory === category;
            const catInfo = ASSET_CATEGORIES[category];
            const Icon = catInfo.icon;

            return (
              <button
                key={category}
                type="button"
                onClick={() => handleCategoryChange(category)}
                className={`p-3 sm:p-3.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 relative ${
                  isSelected
                    ? 'bg-slate-950 border-emerald-500 text-white shadow-md ring-1 ring-emerald-500/50'
                    : 'bg-slate-950/60 border-slate-800/90 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold font-mono text-xs sm:text-sm tracking-wider">
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span>{catInfo.label}</span>
                </div>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                    isSelected
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : 'bg-slate-900 text-slate-400 border-slate-800'
                  }`}
                >
                  {catInfo.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selectable Symbols for Active Category */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
            2. Select Symbol ({currentCategoryData.label})
          </label>
          <span className="text-[10px] font-mono text-slate-400">{currentCategoryData.description}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {currentCategoryData.symbols.map((item) => {
            const isSelected = selectedSymbol === item.symbol;
            return (
              <button
                key={item.symbol}
                type="button"
                onClick={() => onSelectSymbol(item.symbol)}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? 'bg-emerald-950/50 border-emerald-500 text-white font-semibold shadow-sm'
                    : 'bg-slate-950 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-mono font-bold">{item.symbol}</div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">{item.name.split('(')[0]}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Bar with Market Session State & Scan Button */}
      <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Left: Selected Instrument Meta */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 flex items-center justify-between sm:justify-start gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-400 text-[10px] block">ACTIVE SYMBOL</span>
            <span className="text-white font-bold">{selectedSymbol}</span>
          </div>
          <div className="border-l border-slate-800 pl-4">
            <span className="text-slate-400 text-[10px] block">LIVE PRICE</span>
            <span className="text-emerald-400 font-bold">
              {isFetchingPrice ? (
                <span className="text-slate-400">Loading...</span>
              ) : ticker && ticker.price ? (
                ticker.price.toFixed(precision)
              ) : (
                '--'
              )}
            </span>
          </div>
          <div className="border-l border-slate-800 pl-4 hidden md:block">
            <span className="text-slate-400 text-[10px] block">SESSION STATUS</span>
            <span
              className={`font-semibold text-[11px] ${
                sessionState === 'MARKET_OPEN'
                  ? 'text-emerald-400'
                  : sessionState === 'OUTSIDE_TRADING_SESSION'
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {sessionState === 'MARKET_OPEN' ? 'OPEN (Active)' : 'MARKET CLOSED'}
            </span>
          </div>
        </div>

        {/* Right: Primary Scan Button */}
        <button
          type="button"
          onClick={onScan}
          disabled={isScanning || (isMarketClosed && activeCategory !== 'CRYPTO')}
          className="py-3 px-6 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold font-mono text-sm rounded-lg shadow-sm transition flex items-center justify-center gap-2 border border-emerald-500/40 cursor-pointer disabled:cursor-not-allowed"
        >
          {isScanning ? (
            <>
              <Search className="w-4 h-4 animate-spin text-white" />
              <span>SCANNING {selectedSymbol}...</span>
            </>
          ) : isMarketClosed && activeCategory !== 'CRYPTO' ? (
            <>
              <Lock className="w-4 h-4 text-slate-400" />
              <span>MARKET CLOSED ({selectedSymbol})</span>
            </>
          ) : (
            <>
              <Search className="w-4 h-4 text-emerald-200" />
              <span>🔍 SCAN {selectedSymbol}</span>
            </>
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SCAN RESULT DISPLAY (1. BEST TRADE, 2. SECOND BEST, 3. SUGGESTIONS)       */}
      {/* ========================================================================= */}
      {scanResult && scanResult.success && (scanResult.bestTrade || scanResult.secondBest || (scanResult.signals && scanResult.signals.length > 0)) ? (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              RANKED SCAN OUTCOMES ({activeCategory})
            </h3>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
              GATE 9 VALIDATED
            </span>
          </div>

          {/* 1. BEST TRADE */}
          {scanResult.bestTrade || (scanResult.signals && scanResult.signals.find(s => s.isBestTrade || s.rankTier === 'BEST_TRADE')) ? (() => {
            const best = scanResult.bestTrade || scanResult.signals!.find(s => s.isBestTrade || s.rankTier === 'BEST_TRADE')!;
            const bestPrec = best.entryPrice < 10 ? 5 : 2;
            return (
              <div className="bg-slate-950 border-2 border-amber-500/80 rounded-xl p-5 space-y-4 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-amber-500 text-slate-950 font-black font-mono text-[10px] px-3 py-1 rounded-bl-lg uppercase tracking-wider">
                  ★ 1. BEST TRADE
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl font-bold font-mono text-white tracking-tight">
                        {best.symbol}
                      </span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                        BEST TRADE
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {best.strategy}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {best.direction === 'BUY' ? (
                      <span className="px-3 py-1 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800 text-sm font-mono font-bold flex items-center gap-1.5 shadow-sm">
                        <TrendingUp className="w-4 h-4" /> BUY
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-lg bg-rose-950 text-rose-400 border border-rose-800 text-sm font-mono font-bold flex items-center gap-1.5 shadow-sm">
                        <TrendingDown className="w-4 h-4" /> SELL
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Entry Price</span>
                    <span className="text-base font-bold text-white mt-0.5 block">{best.entryPrice ? best.entryPrice.toFixed(bestPrec) : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Stop Loss</span>
                    <span className="text-base font-bold text-rose-400 mt-0.5 block">{best.stopLoss ? best.stopLoss.toFixed(bestPrec) : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Take Profit</span>
                    <span className="text-base font-bold text-emerald-400 mt-0.5 block">{best.takeProfit ? best.takeProfit.toFixed(bestPrec) : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">R:R Ratio</span>
                    <span className="text-base font-bold text-blue-400 mt-0.5 block">{best.riskRewardRatio ? `${best.riskRewardRatio}:1` : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Quality Score</span>
                    <span className="text-base font-bold text-emerald-400 mt-0.5 block">{best.score !== undefined ? `${best.score}/100` : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Confidence</span>
                    <span className="text-base font-bold text-sky-400 mt-0.5 block">{best.confidenceScore ? `${best.confidenceScore}%` : '--'}</span>
                  </div>
                </div>

                {best.aiAssessment && (
                  <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 space-y-1">
                    <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px]">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>AI Confluence Assessment</span>
                    </div>
                    <p className="leading-relaxed font-sans text-slate-200">{best.aiAssessment}</p>
                  </div>
                )}
              </div>
            );
          })() : null}

          {/* 2. SECOND BEST */}
          {scanResult.secondBest || (scanResult.signals && scanResult.signals.find(s => s.isSecondBest || s.rankTier === 'SECOND_BEST')) ? (() => {
            const second = scanResult.secondBest || scanResult.signals!.find(s => s.isSecondBest || s.rankTier === 'SECOND_BEST')!;
            const secondPrec = second.entryPrice < 10 ? 5 : 2;
            return (
              <div className="bg-slate-950 border border-emerald-500/80 rounded-xl p-5 space-y-4 shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 font-black font-mono text-[10px] px-3 py-1 rounded-bl-lg uppercase tracking-wider">
                  ★ 2. SECOND BEST
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl font-bold font-mono text-white tracking-tight">
                        {second.symbol}
                      </span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                        SECOND BEST
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {second.strategy}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {second.direction === 'BUY' ? (
                      <span className="px-3 py-1 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800 text-sm font-mono font-bold flex items-center gap-1.5 shadow-sm">
                        <TrendingUp className="w-4 h-4" /> BUY
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-lg bg-rose-950 text-rose-400 border border-rose-800 text-sm font-mono font-bold flex items-center gap-1.5 shadow-sm">
                        <TrendingDown className="w-4 h-4" /> SELL
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Entry Price</span>
                    <span className="text-base font-bold text-white mt-0.5 block">{second.entryPrice ? second.entryPrice.toFixed(secondPrec) : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Stop Loss</span>
                    <span className="text-base font-bold text-rose-400 mt-0.5 block">{second.stopLoss ? second.stopLoss.toFixed(secondPrec) : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Take Profit</span>
                    <span className="text-base font-bold text-emerald-400 mt-0.5 block">{second.takeProfit ? second.takeProfit.toFixed(secondPrec) : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">R:R Ratio</span>
                    <span className="text-base font-bold text-blue-400 mt-0.5 block">{second.riskRewardRatio ? `${second.riskRewardRatio}:1` : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Quality Score</span>
                    <span className="text-base font-bold text-emerald-400 mt-0.5 block">{second.score !== undefined ? `${second.score}/100` : '--'}</span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <span className="text-[10px] text-slate-400 block uppercase">Confidence</span>
                    <span className="text-base font-bold text-sky-400 mt-0.5 block">{second.confidenceScore ? `${second.confidenceScore}%` : '--'}</span>
                  </div>
                </div>
              </div>
            );
          })() : null}

          {/* 3. SUGGESTIONS (Up to 3) */}
          {(() => {
            const sugList = scanResult.suggestions || (scanResult.signals ? scanResult.signals.filter(s => s.isSuggestion || s.rankTier === 'SUGGESTION') : []);
            if (!sugList || sugList.length === 0) return null;
            return (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-1">
                  3. SUGGESTIONS (Up to 3 Additional Validated Setups)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {sugList.map((sug) => {
                    const sugPrec = sug.entryPrice < 10 ? 5 : 2;
                    return (
                      <div key={sug.id} className="bg-slate-950 border border-slate-800/90 rounded-lg p-3.5 space-y-2 text-xs font-mono">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm">{sug.symbol}</span>
                            <span className="text-[9px] bg-sky-950 text-sky-300 border border-sky-800 px-1.5 py-0.5 rounded">
                              SUGGESTION
                            </span>
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sug.direction === 'BUY' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}`}>
                            {sug.direction}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                          <div>Entry: <strong className="text-white">{sug.entryPrice ? sug.entryPrice.toFixed(sugPrec) : '--'}</strong></div>
                          <div>Score: <strong className="text-blue-400">{sug.score}/100</strong></div>
                          <div>SL: <strong className="text-rose-400">{sug.stopLoss ? sug.stopLoss.toFixed(sugPrec) : '--'}</strong></div>
                          <div>TP: <strong className="text-emerald-400">{sug.takeProfit ? sug.takeProfit.toFixed(sugPrec) : '--'}</strong></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      ) : scanResult ? (
        /* Explicit No Setup / Market Closed Outcome */
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3 text-xs animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 font-mono font-bold text-amber-400 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>NO VALID SETUP</span>
            </div>
            <span className="text-[10px] font-mono bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded">
              0 TRADES FORCED
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed font-sans">
            {scanResult.reason || scanResult.message || 'Multi-asset scan completed across selected universe: No setups satisfied all strict Gate 7–9 quality, structure, and risk-reward validation hurdles.'}
          </p>
          <div className="pt-1 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span>Asset Category: {activeCategory}</span>
            <span>Timestamp: {formatTimeWithZone(scanResult.timestamp || Date.now(), preferredTimeZone)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
