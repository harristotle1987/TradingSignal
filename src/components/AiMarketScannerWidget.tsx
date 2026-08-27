import { useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { TradingSignal } from '../types/index.js';
import { Rejected72PlusPanel } from './Rejected72PlusPanel.js';
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
  const [error, setError] = useState<string | null>(null);

  const handleScanBestTrades = useCallback(async () => {
    if (isScanning) return;

    setIsScanning(true);
    setError(null);
    setScanResult(null);
    setScanStage('Screening multi-asset universe (Crypto, Forex, Stocks)...');

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
      const result = await api.triggerScannerManualScan();
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
      console.error('[AiMarketScannerWidget] Manual scan failed:', msg);
      setError(msg || 'Failed to complete market scan. Please try again.');
      setScanResult(null);
    } finally {
      setIsScanning(false);
    }
  }, [isScanning, onSignalsUpdated]);

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
        </button>
      </div>

      {/* Compact Chatbot-Style Card Overlay */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-[92vw] sm:w-96 max-h-[580px] bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl flex flex-col font-sans overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
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

          {/* Card Body - Chatbot Stream */}
          <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs text-slate-300 min-h-[220px] max-h-[440px]">
            {/* AI Assistant Message Bubble */}
            <div className="flex gap-2.5 items-start">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-3 text-slate-300 leading-relaxed text-[11px] space-y-1.5 shadow-sm">
                <p>
                  Hello! I am your <strong className="text-emerald-300">AI Market Scanner</strong>.
                </p>
                <p className="text-slate-400">
                  Click below to scan real-time market setups across Forex, Crypto, and Stocks passing strict 36-gate risk-reward (≥2:1) and MTF confluence rules.
                </p>
              </div>
            </div>

            {/* Scan Action Control */}
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
                    <span>Scanning Market...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-emerald-200" />
                    <span>Scan Best Trades</span>
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
                      <h5 className="text-[11px] font-bold text-emerald-400 tracking-wide uppercase font-mono">
                        Top Opportunities
                      </h5>

                      <div className="space-y-2.5">
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
                            {scanResult.candidateRejectionDetails.some((c: any) => c.is72PlusRejected || c.score >= 72 || c.finalScore >= 72) && (
                              <span className="px-1.5 py-0.5 bg-rose-950 text-rose-300 text-[8px] font-bold rounded border border-rose-800">
                                72+ REJECTED PRESENT
                              </span>
                            )}
                          </div>
                          {scanResult.candidateRejectionDetails.map((cand: any, i: number) => {
                            const is72Plus = cand.is72PlusRejected || (cand.score >= 72 || cand.finalScore >= 72) && cand.finalDecision === 'REJECTED';
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
    </>
  );
}
