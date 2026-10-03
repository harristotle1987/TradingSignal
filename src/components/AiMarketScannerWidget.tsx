import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client.js';
import { TradingSignal } from '../types/index.js';
import { Rejected72PlusPanel } from './Rejected72PlusPanel.js';
import { ReportZoomControls, useReportZoom } from './ReportZoomControls.js';
import { ZoomableReportWrapper } from './ZoomableReportWrapper.js';
import { SignalReportModal } from './SignalReportModal.js';
import { LoginModal } from './LoginModal.js';
import {
  Sparkles,
  X,
  Bot,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Zap,
  ChevronRight,
  Activity,
  Layers,
  Maximize2,
} from 'lucide-react';

interface AiMarketScannerWidgetProps {
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
  onSignalsUpdated?: () => void;
}

export function AiMarketScannerWidget({
  selectedSymbol = 'EURUSD',
  onSelectSymbol,
  onSignalsUpdated,
}: AiMarketScannerWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStage, setScanStage] = useState<string>('');
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [customSymbol, setCustomSymbol] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | 'CRYPTO' | 'FOREX' | 'STOCKS'>('ALL');
  const [currentUser, setCurrentUser] = useState<{ email: string; role: string; admin: boolean } | null>(() => {
    const stored = api.getStoredUser();
    return stored ? { email: stored.email, role: stored.role, admin: stored.admin } : null;
  });

  // Zoom controls state for AI Market Scanner report
  const { zoomLevel, zoomIn, zoomOut, resetZoom, setZoom } = useReportZoom(1.0, 0.7, 1.8, 0.15);
  const [inspectedSignal, setInspectedSignal] = useState<TradingSignal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Fetch admin session status on mount/open
  const checkAuthStatus = useCallback(async () => {
    try {
      const res = await api.getAuthMe();
      if (res.authenticated && res.user) {
        const userObj = { email: res.user.email, role: res.user.role, admin: res.admin };
        setCurrentUser(userObj);
        return userObj;
      } else {
        setCurrentUser(null);
        return null;
      }
    } catch {
      const fallback = api.getStoredUser();
      const userObj = fallback ? { email: fallback.email, role: fallback.role, admin: fallback.admin } : null;
      setCurrentUser(userObj);
      return userObj;
    }
  }, []);

  const handleScanBestTrades = useCallback(async (targetSymbolOverride?: string) => {
    if (isScanning) return;

    // Check live auth state with multi-tier verification
    const stored = api.getStoredUser();
    let authState = currentUser;
    if (!authState?.admin && stored?.admin) {
      authState = { email: stored.email, role: stored.role, admin: stored.admin };
      setCurrentUser(authState);
    }
    if (!authState?.admin) {
      authState = await checkAuthStatus();
    }

    if (!authState?.admin) {
      setError('Admin authentication required: Please create your Admin account or sign in to run on-demand AI market scans.');
      setIsAuthModalOpen(true);
      return;
    }

    const targetToScan = (targetSymbolOverride ?? customSymbol).trim().toUpperCase();

    setIsScanning(true);
    setError(null);
    setScanResult(null);
    setScanStage(
      targetToScan
        ? `Targeted scan: Analyzing ${targetToScan} across 14-pillar ensemble...`
        : `Screening multi-asset universe (${selectedCategory})...`
    );

    // Visual step feedback timers
    const t1 = setTimeout(() => {
      setScanStage('Analyzing trend, momentum & MTF structure...');
    }, 700);

    const t2 = setTimeout(() => {
      setScanStage('Evaluating 36-gate risk-reward (≥2:1) & liquidity...');
    }, 1500);

    const t3 = setTimeout(() => {
      setScanStage('Finalizing AI Assessment & trade ranking...');
    }, 2300);

    try {
      const result = await api.triggerScannerManualScan({
        symbol: targetToScan || undefined,
        category: !targetToScan && selectedCategory !== 'ALL' ? selectedCategory : undefined,
      });
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      if (result) {
        setScanResult(result);
        setError(null);
        if (onSignalsUpdated) {
          onSignalsUpdated();
        }
      } else {
        throw new Error('No response received from market scanner');
      }
    } catch (err: unknown) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('administrative')) {
        setError('Admin authentication required: Please sign in or register your Admin account to run AI market scans.');
        setIsAuthModalOpen(true);
      } else {
        setError(msg || 'Failed to complete market scan. Please try again.');
      }
      setScanResult(null);
    } finally {
      setIsScanning(false);
    }
  }, [isScanning, currentUser, customSymbol, selectedCategory, checkAuthStatus, onSignalsUpdated]);

  // Check auth status on mount and when modal opens, and listen to 401 unauth & auth change events
  useEffect(() => {
    const unsubUnauth = api.onUnauthorized(() => {
      setCurrentUser(null);
    });
    const unsubAuthChange = api.onAuthChange((user) => {
      if (user) {
        setCurrentUser({ email: user.email, role: user.role, admin: user.admin });
      } else {
        setCurrentUser(null);
      }
    });
    checkAuthStatus();
    return () => {
      unsubUnauth();
      unsubAuthChange();
    };
  }, [checkAuthStatus, isOpen]);

  const QUICK_SYMBOLS = [
    { symbol: 'BTCUSDT', label: 'BTC/USDT', cat: 'Crypto' },
    { symbol: 'ETHUSDT', label: 'ETH/USDT', cat: 'Crypto' },
    { symbol: 'SOLUSDT', label: 'SOL/USDT', cat: 'Crypto' },
    { symbol: 'EURUSD', label: 'EUR/USD', cat: 'Forex' },
    { symbol: 'GBPUSD', label: 'GBP/USD', cat: 'Forex' },
    { symbol: 'USDJPY', label: 'USD/JPY', cat: 'Forex' },
    { symbol: 'AAPL', label: 'Apple', cat: 'Stocks' },
    { symbol: 'NVDA', label: 'NVIDIA', cat: 'Stocks' },
    { symbol: 'TSLA', label: 'Tesla', cat: 'Stocks' },
  ];

  return (
    <>
      {/* Floating AI Scanner FAB Button (Bottom-Right) */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          type="button"
          id="btn-ai-scanner-fab"
          onClick={() => {
            setIsOpen((prev) => !prev);
            checkAuthStatus();
          }}
          title="Open AI Market Scanner"
          className="group relative flex items-center gap-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs px-4 py-3 rounded-full shadow-2xl border border-emerald-400/40 transition-all duration-200 transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
          </span>
          <Bot className="w-4 h-4 text-emerald-200 group-hover:rotate-12 transition-transform duration-200" />
          <span className="font-mono tracking-wide uppercase text-[11px]">AI Scanner</span>
        </button>
      </div>

      {/* Compact Chatbot-Style Card Overlay */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-[94vw] sm:w-[420px] max-h-[640px] bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl flex flex-col font-sans overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
          {/* Card Header */}
          <div className="flex items-center justify-between p-3.5 border-b border-slate-800/80 bg-slate-900/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5 font-mono">
                  AI Market Scanner
                </h4>
                <span className="text-[10px] text-slate-400 block font-mono">
                  14-Pillar Ensemble & 36-Gate Confluence Engine
                </span>
              </div>
            </div>

            <button
              type="button"
              id="btn-close-ai-scanner"
              onClick={() => setIsOpen(false)}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              title="Close scanner card"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Card Body - Chatbot Stream */}
          <div className="p-4 overflow-y-auto space-y-3.5 flex-1 text-xs text-slate-300 min-h-[220px] max-h-[500px]">
            {/* Admin Session Status Indicator */}
            {currentUser?.admin ? (
              <div className="flex items-center justify-between px-3 py-2 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-[11px] text-emerald-300">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="font-mono">Admin: <strong>{currentUser.email}</strong></span>
                </div>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold">
                  AUTHORIZED
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between px-3 py-2 bg-amber-950/40 border border-amber-500/30 rounded-xl text-[11px] text-amber-300">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Admin login required to scan</span>
                </div>
                <button
                  type="button"
                  id="btn-scanner-login-link"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-2 py-0.5 rounded font-mono font-bold cursor-pointer transition"
                >
                  Sign In / Register
                </button>
              </div>
            )}

            {/* AI Assistant Intro */}
            <div className="flex gap-2.5 items-start">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-3 text-slate-300 leading-relaxed text-[11px] space-y-1.5 shadow-sm">
                <p>
                  Enter any <strong className="text-emerald-300">Currency Pair, Crypto, Forex, or Stock</strong> symbol below, or pick from quick-select chips to scan on demand.
                </p>
              </div>
            </div>

            {/* Symbol Input & Asset Class Filter */}
            <div className="space-y-2 bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>TARGET SYMBOL / PAIR</span>
                <span className="text-[10px] text-slate-500">Forex • Crypto • Stocks</span>
              </div>

              <div className="relative">
                <input
                  type="text"
                  id="input-scanner-target-symbol"
                  value={customSymbol}
                  onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. BTCUSDT, EURUSD, AAPL, NVDA, SOLUSDT..."
                  className="w-full bg-slate-950 border border-slate-700/80 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 rounded-xl px-3 py-2 text-white font-mono text-xs placeholder:text-slate-600 uppercase tracking-wider outline-none transition"
                />
                {customSymbol && (
                  <button
                    type="button"
                    onClick={() => setCustomSymbol('')}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white cursor-pointer text-xs"
                    title="Clear symbol"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Quick Select Chips */}
              <div className="space-y-1 pt-1">
                <span className="text-[10px] text-slate-500 font-mono block">QUICK SELECT:</span>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_SYMBOLS.map((s) => (
                    <button
                      key={s.symbol}
                      type="button"
                      onClick={() => setCustomSymbol(s.symbol)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-mono transition cursor-pointer border ${
                        customSymbol === s.symbol
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold'
                          : 'bg-slate-950/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-800'
                      }`}
                    >
                      {s.symbol}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category Filter Pills (When no specific symbol is entered) */}
              {!customSymbol && (
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1">
                  {(['ALL', 'CRYPTO', 'FOREX', 'STOCKS'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`flex-1 py-1 rounded-lg text-[10px] font-mono text-center transition cursor-pointer border ${
                        selectedCategory === cat
                          ? 'bg-emerald-600 text-white font-bold border-emerald-400/40'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200 border-slate-800'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Scan Action Control */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                id="btn-scan-best-trades"
                onClick={() => handleScanBestTrades()}
                disabled={isScanning}
                className="w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg border border-emerald-400/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed text-xs font-mono uppercase tracking-wider"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-200" />
                    <span>Analyzing {customSymbol || selectedCategory}...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-emerald-200" />
                    <span>{customSymbol ? `Scan ${customSymbol} with AI` : `Scan ${selectedCategory} Markets`}</span>
                  </>
                )}
              </button>
            </div>

            {/* Scanning / Progress State */}
            {isScanning && (
              <div className="bg-slate-900/80 border border-emerald-500/30 rounded-xl p-3.5 space-y-2.5 animate-pulse">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-400 font-mono font-semibold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 animate-spin" />
                    Scanning Active
                  </span>
                  <span className="text-slate-400 text-[10px] font-mono">Live Engine</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-gradient-to-r from-emerald-500 to-teal-400 h-1.5 rounded-full w-3/4 animate-pulse"></div>
                </div>
                <p className="text-[10px] text-slate-300 font-mono text-center">
                  {scanStage || 'Evaluating market setups...'}
                </p>
              </div>
            )}

            {/* Error State */}
            {error && !isScanning && (
              <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-3 space-y-2.5 text-rose-300 text-[11px]">
                <div className="flex items-center gap-1.5 font-semibold text-rose-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {error.toLowerCase().includes('unauthorized') || error.toLowerCase().includes('administrative')
                      ? 'Admin Authentication Required'
                      : 'Scan Failed'}
                  </span>
                </div>
                <p className="text-slate-300 text-[10px] leading-relaxed">
                  {error.toLowerCase().includes('unauthorized') || error.toLowerCase().includes('administrative')
                    ? 'Administrative authentication is required to execute on-demand market scans. Please sign in or register.'
                    : error}
                </p>

                <div className="flex items-center gap-2 pt-1">
                  {error.toLowerCase().includes('unauthorized') || error.toLowerCase().includes('administrative') ? (
                    <button
                      type="button"
                      id="btn-login-ai-scan"
                      onClick={() => setIsAuthModalOpen(true)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] transition cursor-pointer font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-sm"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Sign In as Admin</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      id="btn-retry-ai-scan"
                      onClick={handleScanBestTrades}
                      className="px-2.5 py-1.5 bg-rose-900/50 hover:bg-rose-900 text-rose-200 rounded-lg text-[10px] border border-rose-700/50 transition cursor-pointer font-mono font-bold uppercase tracking-wider"
                    >
                      Retry Scan
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Results Area (Gate 4 Output) */}
            {scanResult && !isScanning && (
              <div className="space-y-3 pt-1 border-t border-slate-800/80">
                {/* 🤖 AI MARKET SCAN Header */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-white font-mono text-xs flex items-center gap-1.5">
                      <span>🤖</span> AI MARKET SCAN
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {scanResult.scanDuration || `${((scanResult.scanDurationMs || 0) / 1000).toFixed(2)}s`}
                    </span>
                  </div>

                  {/* Case 1: Valid Trade Opportunities Found */}
                  {scanResult.acceptedSignals && scanResult.acceptedSignals.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-[11px] font-bold text-emerald-400 tracking-wide uppercase font-mono">
                          Top Opportunities
                        </h5>
                        <ReportZoomControls
                          zoomLevel={zoomLevel}
                          onZoomIn={zoomIn}
                          onZoomOut={zoomOut}
                          onResetZoom={resetZoom}
                          onSetZoom={setZoom}
                          compact={true}
                          idPrefix="widget-report-zoom"
                        />
                      </div>

                      <ZoomableReportWrapper zoomLevel={zoomLevel} id="widget-report-wrapper" className="space-y-2.5">
                        {scanResult.acceptedSignals.map((sig: TradingSignal, idx: number) => {
                          const scoreVal = sig.score || sig.confidenceScore || 72;
                          const rrVal = (sig as any).netRiskRewardRatio ?? sig.riskRewardRatio ?? 2.0;
                          
                          let whyText = 'Strong MTF trend alignment and momentum confluence';
                          if (sig.aiAssessment && sig.aiAssessment.includes(': ')) {
                            const afterColon = sig.aiAssessment.split(': ').slice(1).join(': ').trim();
                            if (afterColon && !afterColon.startsWith('Pending') && !afterColon.startsWith('Scan')) {
                              whyText = afterColon;
                            }
                          } else if (sig.confluenceReasons && sig.confluenceReasons.length > 0) {
                            whyText = sig.confluenceReasons.slice(0, 2).join('; ');
                          }

                          return (
                            <div
                              key={sig.id || idx}
                              className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2 hover:border-emerald-500/40 transition"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold font-mono text-white text-xs tracking-wider">{sig.symbol}</span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                    sig.direction === 'BUY'
                                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                  }`}
                                >
                                  {sig.direction}
                                </span>
                              </div>

                              <div className="space-y-1 text-[11px] font-mono text-slate-300">
                                <div className="flex items-center justify-between text-slate-300">
                                  <span>Score: <strong className="text-white">{scoreVal}/100</strong></span>
                                  <span>R:R: <strong className="text-emerald-400">{rrVal.toFixed(1)}:1</strong></span>
                                </div>
                                <div className="text-[10px] text-slate-400 leading-snug pt-1 border-t border-slate-800/60">
                                  <span className="text-slate-500 font-semibold">Why: </span>
                                  <span className="text-slate-300">{whyText}</span>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-1 text-[9px] font-mono bg-slate-900/60 p-1.5 rounded-lg border border-slate-800/60 mt-1">
                                <div>
                                  <span className="text-slate-500 block">ENTRY</span>
                                  <span className="text-white font-semibold">{sig.entryPrice}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">TP1</span>
                                  <span className="text-emerald-400 font-semibold">{sig.tp1 || sig.takeProfit}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">SL</span>
                                  <span className="text-rose-400 font-semibold">{sig.stopLoss}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setInspectedSignal(sig)}
                                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-300 border border-slate-800 transition min-h-[22px] min-w-[22px] flex items-center justify-center cursor-pointer"
                                  title="Inspect Full AI Signals Report with Deep Zoom"
                                >
                                  <Maximize2 className="w-3 h-3" />
                                </button>
                                {onSelectSymbol && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onSelectSymbol(sig.symbol);
                                      setIsOpen(false);
                                    }}
                                    className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-mono rounded-lg border border-slate-700 transition flex items-center justify-center gap-1 cursor-pointer mt-1"
                                  >
                                    <span>View {sig.symbol} Setup</span>
                                    <ChevronRight className="w-3 h-3 text-slate-400" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </ZoomableReportWrapper>

                      <div className="text-[11px] font-mono font-bold text-emerald-400 text-center pt-1 border-t border-slate-800">
                        {scanResult.acceptedSignals.length} valid {scanResult.acceptedSignals.length === 1 ? 'opportunity' : 'opportunities'} found.
                      </div>
                    </div>
                  ) : (
                    /* Case 2: Zero Setups Qualified Gate 4 Validation */
                    <div className="space-y-2 text-center py-2">
                      <ShieldCheck className="w-6 h-6 text-amber-400 mx-auto" />
                      <p className="text-white text-[12px] font-bold font-mono">
                        No tradeable setups found.
                      </p>
                      <p className="text-slate-400 text-[10px] leading-relaxed font-mono">
                        All candidates failed the existing validation criteria.
                      </p>

                      {/* Granular Aggregate Rejection Reasons */}
                      {scanResult.rejectionReasonsCounts && Object.keys(scanResult.rejectionReasonsCounts).length > 0 && (
                        <div className="text-left bg-slate-950/90 p-2.5 rounded-lg border border-amber-900/40 text-[9px] font-mono space-y-1.5 mt-2">
                          <span className="text-amber-400 font-bold block text-[10px] uppercase tracking-wider">
                            Rejection Reasons Breakdown:
                          </span>
                          <div className="grid grid-cols-2 gap-1">
                            {Object.entries(scanResult.rejectionReasonsCounts).map(([gate, count]) => (
                              <div key={gate} className="flex items-center justify-between bg-slate-900/80 px-1.5 py-1 rounded border border-slate-800 text-slate-300">
                                <span className="truncate pr-1 text-slate-400">{gate}</span>
                                <span className="font-bold text-amber-400 bg-amber-950/60 px-1 rounded">{String(count)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Candidate Specific Audit Trail */}
                      {scanResult.candidateRejectionDetails && scanResult.candidateRejectionDetails.length > 0 ? (
                        <div className="text-left bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80 text-[9px] font-mono text-slate-400 max-h-56 overflow-y-auto space-y-2 mt-2">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300 font-semibold block uppercase tracking-wider">Candidate Rejection Telemetry:</span>
                            {scanResult.candidateRejectionDetails.some((c: any) => c.isQualifiedRejected || c.score >= 70 || c.finalScore >= 70) && (
                              <span className="px-1.5 py-0.5 bg-rose-950 text-rose-300 text-[8px] font-bold rounded border border-rose-800">
                                70+ REJECTED PRESENT
                              </span>
                            )}
                          </div>
                          {scanResult.candidateRejectionDetails.map((cand: any, i: number) => {
                            const is72Plus = cand.isQualifiedRejected || (cand.score >= 70 || cand.finalScore >= 70) && cand.finalDecision === 'REJECTED';
                            return (
                              <div
                                key={i}
                                className={`p-2 rounded border space-y-1 ${
                                  is72Plus
                                    ? 'bg-rose-950/20 border-rose-900/60 text-slate-200'
                                    : 'bg-slate-900/60 border-slate-800/80 text-slate-300'
                                }`}
                              >
                                <div className="flex items-center justify-between font-bold">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-white text-[10px]">{cand.symbol}</span>
                                    {cand.direction && (
                                      <span className={`px-1 py-0.2 text-[8px] rounded ${cand.direction === 'BUY' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}`}>
                                        {cand.direction}
                                      </span>
                                    )}
                                  </div>
                                  <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold ${is72Plus ? 'bg-amber-950 text-amber-300 border border-amber-800/80' : 'bg-slate-800 text-slate-400'}`}>
                                    Score: {cand.score || cand.finalScore}/100
                                  </span>
                                </div>

                                {is72Plus && (
                                  <div className="inline-block px-1.5 py-0.2 bg-rose-900/50 text-rose-300 text-[8px] font-bold rounded border border-rose-700/60 tracking-wide uppercase">
                                    STATUS: {cand.statusText || 'REJECTED — NOT TRADEABLE'}
                                  </div>
                                )}

                                {(cand.entryPrice || cand.stopLoss || cand.takeProfit || cand.tp1) && (
                                  <div className="grid grid-cols-3 gap-1 bg-slate-950/80 p-1 rounded border border-slate-800 text-[8px]">
                                    <div>
                                      <span className="text-slate-500 block">ENTRY</span>
                                      <span className="text-slate-200 font-semibold">{cand.entryPrice ?? 'N/A'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block">SL</span>
                                      <span className="text-rose-400 font-semibold">{cand.stopLoss ?? 'N/A'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block">TP1</span>
                                      <span className="text-emerald-400 font-semibold">{cand.tp1 ?? cand.takeProfit ?? 'N/A'}</span>
                                    </div>
                                  </div>
                                )}

                                <p className="text-amber-300/90 text-[8.5px] leading-tight">
                                  <span className="font-semibold text-rose-300">Reason: </span>
                                  {cand.rejectionSummary || cand.primaryRejectionReason}
                                </p>

                                {cand.failedGates && cand.failedGates.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {cand.failedGates.map((g: string, gi: number) => (
                                      <span key={gi} className="px-1 py-0.2 bg-slate-900 text-[7.5px] text-rose-300 rounded border border-rose-900/50">
                                        {g}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : scanResult.rejectionReasons && scanResult.rejectionReasons.length > 0 && (
                        <div className="text-left bg-slate-950/80 p-2 rounded-lg border border-slate-800/80 text-[9px] font-mono text-slate-400 max-h-24 overflow-y-auto space-y-1 mt-2">
                          <span className="text-amber-400 font-semibold block">Validation Audit:</span>
                          {scanResult.rejectionReasons.map((reason: string, i: number) => (
                            <p key={i} className="line-clamp-2">
                              • {reason}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Dedicated 72+ HIGH-SCORE REJECTED SETUPS Panel */}
                {scanResult.candidateRejectionDetails && scanResult.candidateRejectionDetails.length > 0 && (
                  <Rejected72PlusPanel candidates={scanResult.candidateRejectionDetails} compact={true} />
                )}
              </div>
            )}
          </div>

          {/* Card Footer */}
          <div className="p-2.5 bg-slate-900/90 border-t border-slate-800/80 text-center text-[9px] font-mono text-slate-500">
            Zero automatic polling • User-triggered scan execution only
          </div>
        </div>
      )}

      {/* AI Signals Report Deep-Dive Inspection Modal with Zoom */}
      <SignalReportModal
        signal={inspectedSignal}
        isOpen={!!inspectedSignal}
        onClose={() => setInspectedSignal(null)}
      />

      {/* Admin Login / Registration Modal */}
      <LoginModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={(user) => {
          setCurrentUser({ email: user.email, role: user.role, admin: user.admin });
          setIsAuthModalOpen(false);
          setError(null);
          setTimeout(() => {
            handleScanBestTrades();
          }, 200);
        }}
      />
    </>
  );
}
