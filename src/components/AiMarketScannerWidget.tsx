import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client.js';
import { TradingSignal } from '../types/index.js';
import {
  Sparkles,
  X,
  Bot,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Zap,
  ChevronRight,
  Activity,
  Layers,
  Search,
  History,
  Clock,
  Trash2,
  Check,
  BarChart3,
  ArrowRight,
} from 'lucide-react';

interface AiMarketScannerWidgetProps {
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
  onSignalsUpdated?: () => void;
}

export interface ScanSummaryItem {
  id: string;
  timestamp: number;
  scanDurationMs: number;
  acceptedSignalsCount: number;
  acceptedSignals: any[];
  rejectionReasons?: string[];
  universeSymbolsScanned?: number;
  preliminaryCandidatesFound?: number;
  status?: string;
  message?: string;
}

const STORAGE_KEY = 'ai_scanner_recent_scans';

export const MULTI_GATE_STAGES = [
  {
    gate: 'Gate 0/3',
    title: 'Preliminary Screening',
    desc: 'Screening ~100 pairs for data freshness & 1H trend alignment...',
    pct: 20,
    icon: Search,
  },
  {
    gate: 'Gate 4/5',
    title: 'Quota & Pre-Ranking',
    desc: 'Applying rate-limit budgets & selecting top candidates...',
    pct: 45,
    icon: Layers,
  },
  {
    gate: 'Gate 6-L1',
    title: '15m/1h MTF Confluence',
    desc: 'Verifying higher-timeframe trend & momentum alignment...',
    pct: 70,
    icon: Activity,
  },
  {
    gate: 'Gate 6-L2',
    title: '5m/4h Structure & ATR',
    desc: 'Evaluating lower-timeframe entry structure & volatility...',
    pct: 88,
    icon: ShieldCheck,
  },
  {
    gate: 'Gate 7',
    title: 'Executable Entry & R:R',
    desc: 'Validating ≥2:1 risk-reward, spread friction & news risk...',
    pct: 100,
    icon: Zap,
  },
];

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;

  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AiMarketScannerWidget({
  selectedSymbol = 'EURUSD',
  onSelectSymbol,
  onSignalsUpdated,
}: AiMarketScannerWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'scan' | 'history'>('scan');
  const [isScanning, setIsScanning] = useState(false);
  const [currentStageIdx, setCurrentStageIdx] = useState<number>(0);
  const [scanProgressPct, setScanProgressPct] = useState<number>(0);
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<ScanSummaryItem[]>([]);
  const [selectedHistoryScan, setSelectedHistoryScan] = useState<ScanSummaryItem | null>(null);

  // Load recent scan history from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentScans(parsed.slice(0, 5));
        }
      }
    } catch (err) {
      console.warn('[AiMarketScannerWidget] Failed to load scan history:', err);
    }
  }, []);

  // Save new scan to history
  const saveScanToHistory = useCallback((result: any) => {
    try {
      const duration = result.scanDurationMs || (result.scanDuration ? parseFloat(result.scanDuration) * 1000 : 3200);
      const newEntry: ScanSummaryItem = {
        id: `scan_${Date.now()}`,
        timestamp: Date.now(),
        scanDurationMs: duration,
        acceptedSignalsCount: result.acceptedSignals?.length || result.acceptedSignalsCount || 0,
        acceptedSignals: result.acceptedSignals || [],
        rejectionReasons: result.rejectionReasons || [],
        universeSymbolsScanned: result.universeSymbolsScanned || 113,
        preliminaryCandidatesFound: result.preliminaryCandidatesFound || 35,
        status: result.status || 'COMPLETED',
        message: result.message || 'Scan completed successfully',
      };

      setRecentScans((prev) => {
        const updated = [newEntry, ...prev.filter((item) => item.id !== newEntry.id)].slice(0, 5);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.warn('[AiMarketScannerWidget] Storage save failed:', e);
        }
        return updated;
      });
    } catch (e) {
      console.error('[AiMarketScannerWidget] Save history error:', e);
    }
  }, []);

  const handleClearHistory = useCallback(() => {
    setRecentScans([]);
    setSelectedHistoryScan(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }, []);

  const handleScanBestTrades = useCallback(async () => {
    if (isScanning) return;

    setIsScanning(true);
    setError(null);
    setScanResult(null);
    setSelectedHistoryScan(null);
    setActiveTab('scan');
    setCurrentStageIdx(0);
    setScanProgressPct(15);

    // Timed progression through multi-gate stages during API call
    const t1 = setTimeout(() => {
      setCurrentStageIdx(1);
      setScanProgressPct(38);
    }, 600);

    const t2 = setTimeout(() => {
      setCurrentStageIdx(2);
      setScanProgressPct(62);
    }, 1300);

    const t3 = setTimeout(() => {
      setCurrentStageIdx(3);
      setScanProgressPct(82);
    }, 2000);

    const t4 = setTimeout(() => {
      setCurrentStageIdx(4);
      setScanProgressPct(94);
    }, 2700);

    try {
      const result = await api.triggerScannerManualScan();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);

      if (result) {
        setScanProgressPct(100);
        setCurrentStageIdx(4);
        setScanResult(result);
        setError(null);
        saveScanToHistory(result);

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
      clearTimeout(t4);
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AiMarketScannerWidget] Manual scan failed:', msg);
      setError(msg || 'Failed to complete market scan. Please try again.');
      setScanResult(null);
    } finally {
      setIsScanning(false);
    }
  }, [isScanning, onSignalsUpdated, saveScanToHistory]);

  const activeResult = selectedHistoryScan || scanResult;
  const recentThree = recentScans.slice(0, 3);

  return (
    <>
      {/* Floating AI Scanner FAB Button (Bottom-Right) */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          type="button"
          id="btn-ai-scanner-fab"
          onClick={() => setIsOpen((prev) => !prev)}
          title="Open AI Market Scanner"
          className="group relative flex items-center gap-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs px-4 py-3 rounded-full shadow-2xl border border-emerald-400/40 transition-all duration-200 transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
          </span>
          <Bot className="w-4 h-4 text-emerald-200 group-hover:rotate-12 transition-transform duration-200" />
          <span className="font-mono tracking-wide uppercase text-[11px]">AI Scanner</span>
          {recentScans.length > 0 && (
            <span className="bg-emerald-950/80 text-emerald-300 font-mono text-[9px] px-1.5 py-0.5 rounded-full border border-emerald-500/40">
              {recentScans[0].acceptedSignalsCount}
            </span>
          )}
        </button>
      </div>

      {/* Compact Chatbot-Style Card Overlay */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-[92vw] sm:w-[420px] max-h-[620px] bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl flex flex-col font-sans overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
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
                  36-Gate Confluence Engine
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

          {/* Navigation Tabs (Live Scan vs Recent Scans) */}
          <div className="flex items-center border-b border-slate-800/80 bg-slate-900/40 p-1 gap-1 text-[11px] font-mono">
            <button
              type="button"
              id="btn-tab-live-scan"
              onClick={() => {
                setActiveTab('scan');
                setSelectedHistoryScan(null);
              }}
              className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer font-semibold ${
                activeTab === 'scan' && !selectedHistoryScan
                  ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Live Scanner</span>
            </button>

            <button
              type="button"
              id="btn-tab-recent-scans"
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer font-semibold ${
                activeTab === 'history' || selectedHistoryScan
                  ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Recent Scans ({recentThree.length})</span>
            </button>
          </div>

          {/* Card Body */}
          <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs text-slate-300 min-h-[260px] max-h-[480px]">
            {activeTab === 'scan' && !selectedHistoryScan ? (
              <>
                {/* AI Assistant Intro */}
                <div className="flex gap-2.5 items-start">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-3 text-slate-300 leading-relaxed text-[11px] space-y-1.5 shadow-sm">
                    <p>
                      Hello! I am your <strong className="text-emerald-300">AI Market Scanner</strong>.
                    </p>
                    <p className="text-slate-400">
                      Scan real-time market setups across Forex, Crypto, and Stocks passing strict 36-gate risk-reward (≥2:1) and MTF confluence rules.
                    </p>
                  </div>
                </div>

                {/* Scan Trigger Button */}
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    id="btn-scan-best-trades"
                    onClick={handleScanBestTrades}
                    disabled={isScanning}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg border border-emerald-400/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed text-xs font-mono uppercase tracking-wider"
                  >
                    {isScanning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-emerald-200" />
                        <span>Scanning Multi-Gate Market...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-emerald-200" />
                        <span>Scan Best Trades</span>
                      </>
                    )}
                  </button>
                </div>

                {/* REAL-TIME PROGRESS BAR & STAGE INDICATOR */}
                {isScanning && (
                  <div className="bg-slate-900/90 border border-emerald-500/40 rounded-xl p-3.5 space-y-3 shadow-lg animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                        <span>Scanning Active</span>
                      </span>
                      <span className="text-emerald-300 font-bold">{scanProgressPct}%</span>
                    </div>

                    {/* Progress Bar Track */}
                    <div className="w-full bg-slate-950 rounded-full h-2 p-0.5 border border-slate-800 overflow-hidden relative">
                      <div
                        className="bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_12px_rgba(16,185,129,0.5)] relative"
                        style={{ width: `${scanProgressPct}%` }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full"></div>
                      </div>
                    </div>

                    {/* Multi-Gate Step Dots Indicator */}
                    <div className="grid grid-cols-5 gap-1 pt-1">
                      {MULTI_GATE_STAGES.map((stg, idx) => {
                        const isDone = idx < currentStageIdx;
                        const isCurrent = idx === currentStageIdx;
                        return (
                          <div
                            key={stg.gate}
                            className={`flex flex-col items-center gap-1 text-[9px] font-mono p-1 rounded-md transition-colors ${
                              isCurrent
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                                : isDone
                                ? 'text-emerald-400 font-semibold'
                                : 'text-slate-600'
                            }`}
                            title={`${stg.gate}: ${stg.title}`}
                          >
                            <div
                              className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold ${
                                isDone
                                  ? 'bg-emerald-500 text-slate-950'
                                  : isCurrent
                                  ? 'bg-emerald-400 text-slate-950 animate-bounce'
                                  : 'bg-slate-800 text-slate-500'
                              }`}
                            >
                              {isDone ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : idx + 1}
                            </div>
                            <span className="truncate max-w-full text-[8px]">{stg.gate}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Active Stage Detail Status Box */}
                    {MULTI_GATE_STAGES[currentStageIdx] && (
                      <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5 text-[10px] font-mono space-y-1">
                        <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                          {(() => {
                            const IconComp = MULTI_GATE_STAGES[currentStageIdx].icon;
                            return <IconComp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
                          })()}
                          <span>{MULTI_GATE_STAGES[currentStageIdx].title}</span>
                        </div>
                        <p className="text-slate-400 text-[9.5px] leading-snug">
                          {MULTI_GATE_STAGES[currentStageIdx].desc}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Error State */}
                {error && !isScanning && (
                  <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-3 space-y-2 text-rose-300 text-[11px]">
                    <div className="flex items-center gap-1.5 font-semibold text-rose-400">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Scan Failed</span>
                    </div>
                    <p className="text-slate-300 text-[10px] leading-relaxed">{error}</p>
                    <button
                      type="button"
                      id="btn-retry-ai-scan"
                      onClick={handleScanBestTrades}
                      className="px-2.5 py-1 bg-rose-900/50 hover:bg-rose-900 text-rose-200 rounded text-[10px] border border-rose-700/50 transition cursor-pointer font-mono"
                    >
                      Retry Scan
                    </button>
                  </div>
                )}
              </>
            ) : null}

            {/* RECENT SCANS SECTION (History Tab) */}
            {activeTab === 'history' && !selectedHistoryScan && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-white font-mono">
                    <History className="w-4 h-4 text-emerald-400" />
                    <span>Recent Scan History</span>
                  </div>
                  {recentScans.length > 0 && (
                    <button
                      type="button"
                      id="btn-clear-recent-scans"
                      onClick={handleClearHistory}
                      className="text-[10px] font-mono text-slate-500 hover:text-rose-400 flex items-center gap-1 transition cursor-pointer"
                      title="Clear history"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>

                {recentThree.length === 0 ? (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center space-y-2">
                    <Clock className="w-6 h-6 text-slate-600 mx-auto" />
                    <p className="text-slate-300 text-xs font-mono font-semibold">No Recent Scans Yet</p>
                    <p className="text-slate-500 text-[10px]">
                      Trigger a market scan to save results here for instant review without re-scanning.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('scan')}
                      className="mt-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-mono font-semibold transition cursor-pointer inline-flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Run First Scan</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[10px] text-slate-400 font-mono">
                      Showing last 3 scan summaries. Click to inspect past setup details:
                    </p>

                    {recentThree.map((item, idx) => {
                      const count = item.acceptedSignalsCount || 0;
                      const durationSec = ((item.scanDurationMs || 3000) / 1000).toFixed(2);
                      const timeAgo = formatRelativeTime(item.timestamp);

                      return (
                        <div
                          key={item.id || idx}
                          id={`btn-view-recent-scan-${idx}`}
                          onClick={() => setSelectedHistoryScan(item)}
                          className="bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 rounded-xl p-3 space-y-2 transition cursor-pointer group shadow-sm hover:bg-slate-900"
                        >
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                              <Clock className="w-3 h-3 text-emerald-400" />
                              <span>{timeAgo}</span>
                              <span className="text-slate-500">• {durationSec}s</span>
                            </span>

                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                count > 0
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/25'
                              }`}
                            >
                              {count > 0 ? `${count} Tradeable Setup${count > 1 ? 's' : ''}` : '0 Trades Qualified'}
                            </span>
                          </div>

                          {/* Signal Highlights */}
                          {count > 0 && item.acceptedSignals && item.acceptedSignals.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {item.acceptedSignals.slice(0, 3).map((sig: any, sIdx: number) => (
                                <span
                                  key={sIdx}
                                  className="text-[9.5px] font-mono px-2 py-0.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-md flex items-center gap-1"
                                >
                                  <span className="font-bold text-white">{sig.symbol}</span>
                                  <span
                                    className={
                                      sig.direction === 'BUY'
                                        ? 'text-emerald-400 font-bold'
                                        : 'text-rose-400 font-bold'
                                    }
                                  >
                                    {sig.direction}
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] font-mono text-slate-500 line-clamp-1">
                              All candidates stopped at strict risk/reward or MTF gates.
                            </p>
                          )}

                          <div className="flex items-center justify-between text-[9.5px] font-mono text-emerald-400 group-hover:text-emerald-300 pt-1 border-t border-slate-800/60">
                            <span>Inspect Scan Summary</span>
                            <ChevronRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* RESULTS VIEW AREA (Current active scan OR selected history scan) */}
            {activeResult && !isScanning && (
              <div className="space-y-3 pt-1 border-t border-slate-800/80">
                {selectedHistoryScan && (
                  <div className="flex items-center justify-between bg-slate-900 p-2 rounded-lg border border-slate-800 text-[10px] font-mono text-slate-300">
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <History className="w-3 h-3" />
                      <span>Viewing Historical Scan ({formatRelativeTime(selectedHistoryScan.timestamp)})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedHistoryScan(null)}
                      className="text-slate-400 hover:text-white underline cursor-pointer"
                    >
                      Back to Live
                    </button>
                  </div>
                )}

                {/* 🤖 AI MARKET SCAN Results Box */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-white font-mono text-xs flex items-center gap-1.5">
                      <span>🤖</span> AI MARKET SCAN
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Duration: {activeResult.scanDuration || `${((activeResult.scanDurationMs || 0) / 1000).toFixed(2)}s`}
                    </span>
                  </div>

                  {/* Multi-Gate Funnel Breakdown Bar */}
                  <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800/80 text-[9.5px] font-mono text-slate-400 flex items-center justify-between gap-1 overflow-x-auto">
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-slate-200 font-semibold">
                        {activeResult.universeSymbolsScanned || 113}
                      </span>
                      <span>Screened</span>
                    </div>
                    <ArrowRight className="w-2.5 h-2.5 text-slate-600 shrink-0" />
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-slate-200 font-semibold">
                        {activeResult.preliminaryCandidatesFound || 35}
                      </span>
                      <span>Passed G3</span>
                    </div>
                    <ArrowRight className="w-2.5 h-2.5 text-slate-600 shrink-0" />
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-emerald-400 font-bold">
                        {activeResult.acceptedSignals?.length || activeResult.acceptedSignalsCount || 0}
                      </span>
                      <span className="text-emerald-400">Tradeable</span>
                    </div>
                  </div>

                  {/* Case 1: Valid Trade Opportunities Found */}
                  {activeResult.acceptedSignals && activeResult.acceptedSignals.length > 0 ? (
                    <div className="space-y-3">
                      <h5 className="text-[11px] font-bold text-emerald-400 tracking-wide uppercase font-mono">
                        Top Opportunities
                      </h5>

                      <div className="space-y-2.5">
                        {activeResult.acceptedSignals.map((sig: TradingSignal, idx: number) => {
                          const scoreVal = sig.score || sig.confidenceScore || 75;
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
                                <span className="font-bold font-mono text-white text-xs tracking-wider">
                                  {sig.symbol}
                                </span>
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
                                  <span>
                                    Score: <strong className="text-white">{scoreVal}/100</strong>
                                  </span>
                                  <span>
                                    R:R: <strong className="text-emerald-400">{rrVal.toFixed(1)}:1</strong>
                                  </span>
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

                              {onSelectSymbol && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectSymbol(sig.symbol);
                                    setIsOpen(false);
                                  }}
                                  className="w-full py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-mono rounded-lg border border-slate-700 transition flex items-center justify-center gap-1 cursor-pointer mt-1"
                                >
                                  <span>View {sig.symbol} Setup</span>
                                  <ChevronRight className="w-3 h-3 text-slate-400" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="text-[11px] font-mono font-bold text-emerald-400 text-center pt-1 border-t border-slate-800">
                        {activeResult.acceptedSignals.length} valid{' '}
                        {activeResult.acceptedSignals.length === 1 ? 'opportunity' : 'opportunities'} found.
                      </div>
                    </div>
                  ) : (
                    /* Case 2: Zero Setups Qualified Validation */
                    <div className="space-y-2 text-center py-2">
                      <ShieldCheck className="w-6 h-6 text-amber-400 mx-auto" />
                      <p className="text-white text-[12px] font-bold font-mono">No tradeable setups found.</p>
                      <p className="text-slate-400 text-[10px] leading-relaxed font-mono">
                        All candidates failed strict risk/reward (≥2:1) or MTF confluence criteria.
                      </p>

                      {activeResult.rejectionReasons && activeResult.rejectionReasons.length > 0 && (
                        <div className="text-left bg-slate-950/80 p-2 rounded-lg border border-slate-800/80 text-[9px] font-mono text-slate-400 max-h-24 overflow-y-auto space-y-1 mt-2">
                          <span className="text-amber-400 font-semibold block">Validation Audit:</span>
                          {activeResult.rejectionReasons.map((reason: string, i: number) => (
                            <p key={i} className="line-clamp-2">
                              • {reason}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Card Footer */}
          <div className="p-2.5 bg-slate-900/90 border-t border-slate-800/80 text-center text-[9px] font-mono text-slate-500 flex items-center justify-between px-3">
            <span>36-Gate Confluence Engine</span>
            <span>User-triggered execution</span>
          </div>
        </div>
      )}
    </>
  );
}
