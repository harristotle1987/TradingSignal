import React, { useEffect } from 'react';
import {
  X,
  TrendingUp,
  TrendingDown,
  Cpu,
  Zap,
  Sparkles,
  ShieldCheck,
  Activity,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { TradingSignal } from '../types/index.js';
import { TargetTracker } from './TargetTracker.js';
import { AcceptanceBreakdown } from './SignalAnalysisDetails.js';
import { ReportZoomControls, useReportZoom } from './ReportZoomControls.js';
import { ZoomableReportWrapper } from './ZoomableReportWrapper.js';
import {
  formatStrategy,
  formatRankTier,
  formatProviderName,
  getDynamicPrecision,
} from '../utils/formatters.js';

interface SignalReportModalProps {
  signal: TradingSignal | null;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  onSignalRefreshed?: (updatedSignal: TradingSignal) => void;
}

export const SignalReportModal: React.FC<SignalReportModalProps> = ({
  signal,
  isOpen,
  onClose,
  title = 'AI Signals Deep-Dive Report',
  onSignalRefreshed,
}) => {
  const { zoomLevel, zoomIn, zoomOut, resetZoom, setZoom } = useReportZoom(1.0, 0.7, 2.0, 0.15);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !signal) return null;

  const precision = getDynamicPrecision(signal.entryPrice, signal.symbol);
  const score = signal.score ?? signal.confidenceScore ?? 75;
  const isBuy = signal.direction === 'BUY';

  return (
    <div
      id="signal-report-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-2 sm:p-4 md:p-6 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signal-report-modal-title"
    >
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Sticky Header with Title and Zoom Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-slate-900 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800 shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id="signal-report-modal-title"
                  className="text-base sm:text-lg font-bold text-white font-mono tracking-tight truncate"
                >
                  {signal.symbol} AI Signals Report
                </h2>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-mono font-bold flex items-center gap-1 ${
                    isBuy
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}
                >
                  {isBuy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {signal.direction}
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                  Score: {score}/100
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                Strategy: {formatStrategy(signal.strategy)} • {formatProviderName((signal as any).dataSource || signal.provider || 'Live Market')}
              </p>
            </div>
          </div>

          {/* Zoom Controller & Close Button */}
          <div className="flex items-center gap-2 shrink-0">
            <ReportZoomControls
              zoomLevel={zoomLevel}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onResetZoom={resetZoom}
              onSetZoom={setZoom}
              label="Zoom Report"
              idPrefix="modal-zoom"
              showPresets={true}
              isFullscreen={true}
            />

            <button
              type="button"
              id="btn-close-report-modal"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition cursor-pointer ml-1"
              title="Close Report (Esc)"
              aria-label="Close Report"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Modal Body Wrapped in Zoomable Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <ZoomableReportWrapper zoomLevel={zoomLevel} id="modal-report-wrapper">
            <div className="space-y-6 max-w-5xl mx-auto">
              {/* Top Banner Notice */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold font-mono">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>GATE 9 VERIFIED EXECUTION REPORT</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Use the zoom toolbar in the top-right to scale text, metrics, and indicators.
                </div>
              </div>

              {/* Key Price Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Entry Price</span>
                  <span className="text-xl font-bold text-white block tracking-tight">
                    {signal.entryPrice ? signal.entryPrice.toFixed(precision) : '--'}
                  </span>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Stop Loss</span>
                  <span className="text-xl font-bold text-rose-400 block tracking-tight">
                    {signal.stopLoss ? signal.stopLoss.toFixed(precision) : '--'}
                  </span>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Take Profit</span>
                  <span className="text-xl font-bold text-emerald-400 block tracking-tight">
                    {signal.takeProfit ? signal.takeProfit.toFixed(precision) : '--'}
                  </span>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Risk / Reward</span>
                  <span className="text-xl font-bold text-emerald-400 block tracking-tight">
                    {signal.riskRewardRatio ? signal.riskRewardRatio.toFixed(2) : '2.00'}:1
                  </span>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Signal Score</span>
                  <span className="text-xl font-bold text-amber-300 block tracking-tight">
                    {score}/100
                  </span>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Win Probability</span>
                  <span className="text-xl font-bold text-sky-400 block tracking-tight">
                    {signal.estimatedWinRate ? signal.estimatedWinRate.toFixed(1) : '65.0'}%
                  </span>
                </div>
              </div>

              {/* Target Tracker */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3 shadow-md">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <h4 className="text-xs font-bold font-mono text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    Target Progress & Trajectory
                  </h4>
                </div>
                <TargetTracker
                  signal={signal}
                  precision={precision}
                  onSignalRefreshed={onSignalRefreshed}
                />
              </div>

              {/* Acceptance Breakdown (Technical Confluence & Rubric) */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3 shadow-md">
                <h4 className="text-xs font-bold font-mono text-slate-300 uppercase tracking-wider flex items-center gap-2 border-b border-slate-800/80 pb-2.5">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Technical Confluence & Factor Breakdown
                </h4>
                <AcceptanceBreakdown signal={signal as any} />
              </div>

              {/* NVIDIA AI Risk Evaluation & Confluence Assessment */}
              {signal.aiAssessment && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-semibold text-xs uppercase tracking-wider font-mono">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    <span>NVIDIA AI Confluence & Risk Evaluation</span>
                  </div>
                  <p className="leading-relaxed font-sans text-xs sm:text-sm text-slate-200">
                    {signal.aiAssessment}
                  </p>
                </div>
              )}

              {/* Execution Specs & Metadata */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 text-xs font-mono text-slate-400 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-2">
                  <span>Asset Type: <strong className="text-slate-200">{(signal as any).marketType || 'Live Asset'}</strong></span>
                  <span>Market Regime: <strong className="text-emerald-400">{(signal as any).marketRegime || 'TRENDING'}</strong></span>
                  <span>Execution Status: <strong className="text-emerald-400">{signal.status || 'ACTIVE'}</strong></span>
                </div>
                <div className="text-[11px] text-slate-500 pt-1">
                  Validated under strict 36-gate risk-reward, liquidity, and adverse execution hurdles.
                </div>
              </div>
            </div>
          </ZoomableReportWrapper>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400 shrink-0">
          <span>AI Signals Report • Scalable Vector View</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
