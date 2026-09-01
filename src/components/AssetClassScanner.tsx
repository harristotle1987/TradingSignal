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
import { TargetTracker } from './TargetTracker.js';
import {
  TradingSignal,
  NormalizedTicker,
  SignalGenerationResponse,
} from '../types/index.js';
import { formatTimeWithZone, DisplayTimeZone } from '../utils/time.js';
import {
  formatLabel,
  formatStrategy,
  formatRankTier,
  formatProviderName,
  getDynamicPrecision,
} from '../utils/formatters.js';
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

function isStrictlyTradeable(sig: any): boolean {
  return !!(sig && sig.isTradeableSignal === true && sig.signalClassification === 'TRADEABLE');
}

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
  onFetchPrice?: (symbol: string) => Promise<void>;
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
  onFetchPrice,
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
  const precision = ticker ? getDynamicPrecision(ticker.price, selectedSymbol) : 2;

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
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
          1. Select Trade Category
        </label>
        <div className="grid grid-cols-3 gap-1.5 xs:gap-2.5 sm:gap-3">
          {(['CRYPTO', 'FOREX', 'STOCKS'] as AssetCategory[]).map((category) => {
            const isSelected = activeCategory === category;
            const catInfo = ASSET_CATEGORIES[category];
            const Icon = catInfo.icon;

            return (
              <button
                key={category}
                type="button"
                onClick={() => handleCategoryChange(category)}
                className={`p-2 xs:p-3 sm:p-3.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 min-h-[44px] cursor-pointer ${
                  isSelected
                    ? 'bg-slate-950 border-emerald-500 text-white shadow-md ring-1 ring-emerald-500/50'
                    : 'bg-slate-950/60 border-slate-800/90 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-1 xs:gap-1.5 font-bold font-mono text-[11px] xs:text-xs sm:text-sm tracking-wide">
                  <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span className="truncate">{catInfo.label}</span>
                </div>
                <span
                  className={`text-[8px] xs:text-[9px] font-mono px-1 py-0.2 rounded border whitespace-nowrap ${
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
        <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
            2. Select Symbol ({currentCategoryData.label})
          </label>
          <span className="text-[10px] font-mono text-slate-400">{currentCategoryData.description}</span>
        </div>

        <div className="grid grid-cols-2 xs:grid-cols-3 md:grid-cols-6 gap-2">
          {currentCategoryData.symbols.map((item) => {
            const isSelected = selectedSymbol === item.symbol;
            return (
              <button
                key={item.symbol}
                type="button"
                onClick={() => onSelectSymbol(item.symbol)}
                className={`p-2.5 rounded-lg border text-left transition-all min-h-[44px] cursor-pointer ${
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
      <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Left: Selected Instrument Meta */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 flex items-center justify-between sm:justify-start gap-3 xs:gap-4 text-xs font-mono w-full sm:w-auto">
          <div>
            <span className="text-slate-400 text-[10px] block">ACTIVE SYMBOL</span>
            <span className="text-white font-bold">{selectedSymbol}</span>
          </div>
          <div className="border-l border-slate-800 pl-3 xs:pl-4 flex items-center gap-2">
            <div>
              <span className="text-slate-400 text-[10px] block">LIVE PRICE</span>
              <span className="text-emerald-400 font-bold">
                {isFetchingPrice ? (
                  <span className="text-slate-400 text-xs animate-pulse">Loading...</span>
                ) : ticker && ticker.price ? (
                  ticker.price.toFixed(precision)
                ) : (
                  '--'
                )}
              </span>
            </div>
            {onFetchPrice && (
              <button
                type="button"
                id="btn-fetch-market-price"
                onClick={() => {
                  if (isFetchingPrice) return;
                  onFetchPrice(selectedSymbol);
                }}
                disabled={isFetchingPrice}
                title={`Fetch market price for ${selectedSymbol}`}
                className="ml-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[10px] text-slate-300 font-medium rounded border border-slate-700 transition flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <Zap className={`w-3 h-3 text-emerald-400 ${isFetchingPrice ? 'animate-spin' : ''}`} />
                <span>{isFetchingPrice ? 'Fetching...' : ticker?.price ? 'Refresh' : 'Get Price'}</span>
              </button>
            )}
          </div>
          <div className="border-l border-slate-800 pl-3 xs:pl-4 hidden xs:block">
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
              {sessionState === 'MARKET_OPEN' ? 'OPEN (Active)' : 'CLOSED'}
            </span>
          </div>
        </div>

        {/* Right: Primary Scan Button */}
        <button
          type="button"
          onClick={onScan}
          disabled={isScanning || (isMarketClosed && activeCategory !== 'CRYPTO')}
          className="py-3 px-5 sm:px-6 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold font-mono text-xs sm:text-sm rounded-lg shadow-sm transition flex items-center justify-center gap-2 border border-emerald-500/40 cursor-pointer disabled:cursor-not-allowed min-h-[46px] w-full sm:w-auto"
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
              <span>SCAN {selectedSymbol}</span>
            </>
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SCAN RESULT DISPLAY (1. BEST TRADE, 2. SECOND BEST, 3. SUGGESTIONS)       */}
      {/* ========================================================================= */}
      {scanResult && scanResult.success && (
        isStrictlyTradeable(scanResult.bestTrade) ||
        isStrictlyTradeable(scanResult.secondBest) ||
        (scanResult.signals && scanResult.signals.some(isStrictlyTradeable))
      ) ? (
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
          {(() => {
            const bestCandidate = scanResult.bestTrade || (scanResult.signals && scanResult.signals.find(s => s.isBestTrade || s.rankTier === 'BEST_TRADE'));
            if (!isStrictlyTradeable(bestCandidate)) return null;
            const best = bestCandidate;
            const bestPrec = getDynamicPrecision(best.entryPrice, best.symbol);
            return (
              <div className="bg-slate-950 border-2 border-amber-500/80 rounded-xl p-6 sm:p-7 space-y-5 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-amber-500 text-slate-950 font-black font-mono text-xs px-4 py-1.5 rounded-bl-xl uppercase tracking-wider shadow-md">
                  ★ 1. BEST TRADE
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold font-mono text-white tracking-wide">
                        {best.symbol}
                      </span>
                      <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                        {formatRankTier('BEST_TRADE', false)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-1">
                      {formatStrategy(best.strategy)}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {best.direction === 'BUY' ? (
                      <span className="px-4 py-1.5 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800 text-base font-mono font-bold flex items-center gap-2 shadow-sm">
                        <TrendingUp className="w-5 h-5" /> BUY
                      </span>
                    ) : (
                      <span className="px-4 py-1.5 rounded-lg bg-rose-950 text-rose-400 border border-rose-800 text-base font-mono font-bold flex items-center gap-2 shadow-sm">
                        <TrendingDown className="w-5 h-5" /> SELL
                      </span>
                    )}
                  </div>
                </div>

                {/* Grid of Key Price Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5 font-mono">
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Entry Price</span>
                    <span className="text-lg font-bold text-white block tracking-tight">{best.entryPrice ? best.entryPrice.toFixed(bestPrec) : '--'}</span>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Stop Loss</span>
                    <span className="text-lg font-bold text-rose-400 block tracking-tight">{best.stopLoss ? best.stopLoss.toFixed(bestPrec) : '--'}</span>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Take Profit</span>
                    <span className="text-lg font-bold text-emerald-400 block tracking-tight">{best.takeProfit ? best.takeProfit.toFixed(bestPrec) : '--'}</span>
                    {best.tp1 !== undefined && (
                      <div className="text-[10px] text-slate-400 border-t border-slate-800/80 pt-1 space-y-0.5">
                        <div className="flex justify-between"><span>TP1:</span><span className="text-emerald-400 font-bold">{best.tp1.toFixed(bestPrec)}</span></div>
                        {best.tp2 !== undefined && <div className="flex justify-between"><span>TP2:</span><span className="text-emerald-300 font-bold">{best.tp2.toFixed(bestPrec)}</span></div>}
                        {best.tp3 !== undefined && <div className="flex justify-between"><span>TP3:</span><span className="text-emerald-200 font-bold">{best.tp3.toFixed(bestPrec)}</span></div>}
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">R:R Ratio</span>
                    <span className="text-lg font-bold text-blue-400 block tracking-tight">{best.riskRewardRatio ? `${best.riskRewardRatio}:1` : '--'}</span>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Target Quality</span>
                    <span className="text-lg font-bold text-emerald-400 block tracking-tight">
                      {best.targetQualityScore !== undefined ? `${best.targetQualityScore}/100` : `${best.score || 75}/100`}
                    </span>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Signal Score</span>
                    <span className="text-lg font-bold text-sky-400 block tracking-tight">
                      {best.confidenceScore ? `${best.confidenceScore}/100` : '--'}
                    </span>
                  </div>
                </div>

                {/* Gate 72: Separate Win Rate & Empirical Calibration Display */}
                {(() => {
                  const modelWin = best.estimatedWinRate ?? best.modelEstimatedWinRate;
                  const isCalibrated = best.isEmpiricallyCalibrated === true && best.empiricalProbability != null;
                  if (modelWin === undefined && !isCalibrated) return null;
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs pt-1">
                      {modelWin !== undefined && (
                        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                          <span className="text-[10px] text-slate-400 font-bold uppercase">Model Est. Win Rate:</span>
                          <strong className="text-emerald-400 font-bold">{modelWin.toFixed(1)}%</strong>
                        </div>
                      )}
                      {isCalibrated && (
                        <div className="bg-slate-900/90 border border-emerald-900/60 rounded-xl p-3 flex flex-col gap-1 col-span-1 sm:col-span-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-emerald-400 font-bold uppercase">Empirical Win Rate:</span>
                            <strong className="text-emerald-300 font-bold">{best.empiricalProbability.toFixed(1)}%</strong>
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
                            <span>N={best.probabilitySampleSize || '--'}</span>
                            {best.probabilityConfidenceInterval && (
                              <span className="text-sky-300">
                                95% CI: {best.probabilityConfidenceInterval.lower.toFixed(1)}%–{best.probabilityConfidenceInterval.upper.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Target Tracker Progress Card */}
                <TargetTracker signal={best} precision={bestPrec} />

                {best.aiAssessment && (
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 space-y-1.5">
                    <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs uppercase tracking-wider">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>AI Confluence Assessment</span>
                    </div>
                    <p className="leading-relaxed font-sans text-xs sm:text-sm text-slate-200">{best.aiAssessment}</p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* 2. SECOND BEST */}
          {(() => {
            const secondCandidate = scanResult.secondBest || (scanResult.signals && scanResult.signals.find(s => s.isSecondBest || s.rankTier === 'SECOND_BEST'));
            if (!isStrictlyTradeable(secondCandidate)) return null;
            const second = secondCandidate;
            const secondPrec = getDynamicPrecision(second.entryPrice, second.symbol);
            return (
              <div className="bg-slate-950 border border-emerald-500/80 rounded-xl p-6 sm:p-7 space-y-5 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 font-black font-mono text-xs px-4 py-1.5 rounded-bl-xl uppercase tracking-wider shadow-md">
                  ★ 2. SECOND BEST
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold font-mono text-white tracking-wide">
                        {second.symbol}
                      </span>
                      <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                        {formatRankTier('SECOND_BEST', false)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-1">
                      {formatStrategy(second.strategy)}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {second.direction === 'BUY' ? (
                      <span className="px-4 py-1.5 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800 text-base font-mono font-bold flex items-center gap-2 shadow-sm">
                        <TrendingUp className="w-5 h-5" /> BUY
                      </span>
                    ) : (
                      <span className="px-4 py-1.5 rounded-lg bg-rose-950 text-rose-400 border border-rose-800 text-base font-mono font-bold flex items-center gap-2 shadow-sm">
                        <TrendingDown className="w-5 h-5" /> SELL
                      </span>
                    )}
                  </div>
                </div>

                {/* Grid of Key Price Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5 font-mono">
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Entry Price</span>
                    <span className="text-lg font-bold text-white block tracking-tight">{second.entryPrice ? second.entryPrice.toFixed(secondPrec) : '--'}</span>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Stop Loss</span>
                    <span className="text-lg font-bold text-rose-400 block tracking-tight">{second.stopLoss ? second.stopLoss.toFixed(secondPrec) : '--'}</span>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Take Profit</span>
                    <span className="text-lg font-bold text-emerald-400 block tracking-tight">{second.takeProfit ? second.takeProfit.toFixed(secondPrec) : '--'}</span>
                    {second.tp1 !== undefined && (
                      <div className="text-[10px] text-slate-400 border-t border-slate-800/80 pt-1 space-y-0.5">
                        <div className="flex justify-between"><span>TP1:</span><span className="text-emerald-400 font-bold">{second.tp1.toFixed(secondPrec)}</span></div>
                        {second.tp2 !== undefined && <div className="flex justify-between"><span>TP2:</span><span className="text-emerald-300 font-bold">{second.tp2.toFixed(secondPrec)}</span></div>}
                        {second.tp3 !== undefined && <div className="flex justify-between"><span>TP3:</span><span className="text-emerald-200 font-bold">{second.tp3.toFixed(secondPrec)}</span></div>}
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">R:R Ratio</span>
                    <span className="text-lg font-bold text-blue-400 block tracking-tight">{second.riskRewardRatio ? `${second.riskRewardRatio}:1` : '--'}</span>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Target Quality</span>
                    <span className="text-lg font-bold text-emerald-400 block tracking-tight">
                      {second.targetQualityScore !== undefined ? `${second.targetQualityScore}/100` : `${second.score || 75}/100`}
                    </span>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Signal Score</span>
                    <span className="text-lg font-bold text-sky-400 block tracking-tight">
                      {second.confidenceScore ? `${second.confidenceScore}/100` : '--'}
                    </span>
                  </div>
                </div>

                {/* Gate 72: Separate Win Rate & Empirical Calibration Display */}
                {(() => {
                  const modelWin = second.estimatedWinRate ?? second.modelEstimatedWinRate;
                  const isCalibrated = second.isEmpiricallyCalibrated === true && second.empiricalProbability != null;
                  if (modelWin === undefined && !isCalibrated) return null;
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs pt-1">
                      {modelWin !== undefined && (
                        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                          <span className="text-[10px] text-slate-400 font-bold uppercase">Model Est. Win Rate:</span>
                          <strong className="text-emerald-400 font-bold">{modelWin.toFixed(1)}%</strong>
                        </div>
                      )}
                      {isCalibrated && (
                        <div className="bg-slate-900/90 border border-emerald-900/60 rounded-xl p-3 flex flex-col gap-1 col-span-1 sm:col-span-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-emerald-400 font-bold uppercase">Empirical Win Rate:</span>
                            <strong className="text-emerald-300 font-bold">{second.empiricalProbability.toFixed(1)}%</strong>
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
                            <span>N={second.probabilitySampleSize || '--'}</span>
                            {second.probabilityConfidenceInterval && (
                              <span className="text-sky-300">
                                95% CI: {second.probabilityConfidenceInterval.lower.toFixed(1)}%–{second.probabilityConfidenceInterval.upper.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Target Tracker Progress Card */}
                <TargetTracker signal={second} precision={secondPrec} />
              </div>
            );
          })()}

          {/* 3. SUGGESTIONS (Up to 3) */}
          {(() => {
            const rawSugList = scanResult.suggestions || (scanResult.signals ? scanResult.signals.filter(s => s.isSuggestion || s.rankTier === 'SUGGESTION') : []);
            const sugList = (rawSugList || []).filter(isStrictlyTradeable);
            if (!sugList || sugList.length === 0) return null;
            return (
              <div className="space-y-3 pt-2">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <span>3. SUGGESTIONS (Up to 3 Additional Validated Setups)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {sugList.map((sug) => {
                    const sugPrec = getDynamicPrecision(sug.entryPrice, sug.symbol);
                    return (
                      <div key={sug.id || sug.snapshotId || `${sug.symbol}_${sug.timestamp}`} className="bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3 font-mono shadow-md">
                        <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-base">{sug.symbol}</span>
                            <span className="text-[10px] bg-sky-950 text-sky-300 border border-sky-800 px-2 py-0.5 rounded font-semibold">
                              SUGGESTION
                            </span>
                          </div>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-md ${sug.direction === 'BUY' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}`}>
                            {sug.direction}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-slate-900/80 p-2 rounded border border-slate-800/80 col-span-2 flex justify-between items-center">
                            <div>
                              <span className="text-[10px] text-slate-400 block uppercase">Entry Price</span>
                              <strong className="text-white text-sm">{sug.entryPrice ? sug.entryPrice.toFixed(sugPrec) : '--'}</strong>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-slate-400 block uppercase">R:R Ratio</span>
                              <strong className="text-blue-400 text-sm">{sug.riskRewardRatio ? `${sug.riskRewardRatio}:1` : '--'}</strong>
                            </div>
                          </div>
                          <div className="bg-slate-900/80 p-2 rounded border border-slate-800/80">
                            <span className="text-[10px] text-slate-400 block uppercase">Stop Loss</span>
                            <strong className="text-rose-400 text-sm">{sug.stopLoss ? sug.stopLoss.toFixed(sugPrec) : '--'}</strong>
                          </div>
                          <div className="bg-slate-900/80 p-2 rounded border border-slate-800/80">
                            <span className="text-[10px] text-slate-400 block uppercase">Take Profit</span>
                            <strong className="text-emerald-400 text-sm">{sug.takeProfit ? sug.takeProfit.toFixed(sugPrec) : '--'}</strong>
                          </div>
                          <div className="bg-slate-900/80 p-2 rounded border border-slate-800/80">
                            <span className="text-[10px] text-slate-400 block uppercase">Target Quality</span>
                            <strong className="text-emerald-400 text-sm">
                              {sug.targetQualityScore !== undefined ? `${sug.targetQualityScore}/100` : `${sug.score || 75}/100`}
                            </strong>
                          </div>
                          <div className="bg-slate-900/80 p-2 rounded border border-slate-800/80">
                            <span className="text-[10px] text-slate-400 block uppercase">Signal Score</span>
                            <strong className="text-sky-400 text-sm">
                              {sug.confidenceScore ? `${sug.confidenceScore}/100` : '--'}
                            </strong>
                          </div>
                        </div>

                        {/* Gate 72: Suggestion Win Rate & Empirical Calibration Display */}
                        {(() => {
                          const modelWin = sug.estimatedWinRate ?? sug.modelEstimatedWinRate;
                          const isCalibrated = sug.isEmpiricallyCalibrated === true && sug.empiricalProbability != null;
                          if (modelWin === undefined && !isCalibrated) return null;
                          return (
                            <div className="space-y-1.5 pt-1 border-t border-slate-800 text-[11px]">
                              {modelWin !== undefined && (
                                <div className="flex justify-between items-center text-slate-300">
                                  <span className="text-[9px] text-slate-400 uppercase">Model Win:</span>
                                  <strong className="text-emerald-400">{modelWin.toFixed(1)}%</strong>
                                </div>
                              )}
                              {isCalibrated && (
                                <div className="flex flex-col gap-0.5 bg-emerald-950/40 p-1.5 rounded border border-emerald-900/50">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[9px] text-emerald-400 uppercase">Empirical Win:</span>
                                    <strong className="text-emerald-300">{sug.empiricalProbability.toFixed(1)}% (N={sug.probabilitySampleSize || '--'})</strong>
                                  </div>
                                  {sug.probabilityConfidenceInterval && (
                                    <div className="text-[8px] text-sky-300">
                                      95% CI: {sug.probabilityConfidenceInterval.lower.toFixed(1)}%–{sug.probabilityConfidenceInterval.upper.toFixed(1)}%
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {sug.tp1 !== undefined && (
                          <div className="text-xs text-slate-300 bg-slate-900/60 p-2 rounded border border-slate-800/60 space-y-1">
                            <div className="flex justify-between"><span>TP1 (Conservative):</span><strong className="text-emerald-400">{sug.tp1.toFixed(sugPrec)}</strong></div>
                            {sug.tp2 !== undefined && <div className="flex justify-between"><span>TP2 (Main Target):</span><strong className="text-emerald-300">{sug.tp2.toFixed(sugPrec)}</strong></div>}
                            {sug.tp3 !== undefined && <div className="flex justify-between"><span>TP3 (Extended):</span><strong className="text-emerald-200">{sug.tp3.toFixed(sugPrec)}</strong></div>}
                          </div>
                        )}
                        <TargetTracker signal={sug} precision={sugPrec} />
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
              <span>{scanResult.message || 'NO QUALIFIED TRADE'}</span>
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
