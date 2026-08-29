import { useState, useMemo } from 'react';
import { ShieldAlert, ChevronDown, ChevronUp, AlertOctagon, Filter } from 'lucide-react';
import { RejectionBreakdown } from './SignalAnalysisDetails.js';

export interface RejectedCandidateTelemetry {
  symbol: string;
  direction?: 'BUY' | 'SELL';
  score?: number;
  finalScore?: number;
  scoreBeforeGate6?: number;
  primaryRejectionReason?: string;
  failedGates?: string[];
  finalDecision?: string;
  details?: string;
  stage?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  statusText?: string;
  rejectionSummary?: string;
  timestamp?: number;
  is72PlusRejected?: boolean;
  mtfStatus?: string;
  netRiskRewardRatio?: number;
}

interface Rejected72PlusPanelProps {
  candidates?: RejectedCandidateTelemetry[];
  title?: string;
  compact?: boolean;
}

export function Rejected72PlusPanel({
  candidates = [],
  title = '72+ HIGH-SCORE REJECTED SETUPS',
  compact = false,
}: Rejected72PlusPanelProps) {
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  const qualifyingCandidates = useMemo(() => {
    if (!candidates || !Array.isArray(candidates)) return [];
    return candidates.filter((cand) => {
      if (!cand) return false;
      const scoreVal = cand.score ?? cand.finalScore ?? cand.scoreBeforeGate6 ?? 0;
      const decision = cand.finalDecision ?? 'REJECTED';
      const isRejected = decision === 'REJECTED' || cand.is72PlusRejected || cand.statusText?.includes('REJECTED');
      const meetsScore = scoreVal >= 72 || cand.is72PlusRejected === true;
      return meetsScore && isRejected;
    });
  }, [candidates]);

  if (qualifyingCandidates.length === 0) {
    return null; // Don't render empty container if no 72+ candidates were rejected in current telemetry
  }

  const toggleExpand = (sym: string) => {
    setExpandedSymbol((prev) => (prev === sym ? null : sym));
  };

  return (
    <div className="bg-slate-950/95 border border-rose-900/60 rounded-xl p-4 sm:p-5 space-y-4 shadow-xl text-xs font-mono">
      {/* Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-rose-900/40">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-rose-950 text-rose-400 border border-rose-800">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white tracking-wider uppercase flex items-center gap-2">
              <span>{title}</span>
            </h3>
            <span className="text-[10px] text-slate-400 font-sans block">
              High-Score Candidates (Score ≥72) Blocked by Mandatory Risk & Safety Gates
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-rose-950/80 text-rose-300 border border-rose-800 rounded-md text-[10px] font-bold tracking-wide">
            {qualifyingCandidates.length} REJECTED SETUP{qualifyingCandidates.length === 1 ? '' : 'S'}
          </span>
        </div>
      </div>

      {/* Candidate List */}
      <div className="space-y-3">
        {qualifyingCandidates.map((cand, idx) => {
          const scoreVal = cand.score ?? cand.finalScore ?? cand.scoreBeforeGate6 ?? 72;
          const isExpanded = expandedSymbol === cand.symbol;
          const reason = cand.rejectionSummary || cand.primaryRejectionReason || cand.details || 'Failed mandatory safety gate criteria.';
          const primaryFailedGate = cand.failedGates && cand.failedGates.length > 0 ? cand.failedGates[0] : (cand.primaryRejectionReason || 'SAFETY_GATE');

          // Calculate R:R dynamically if available
          let derivedRR = 'N/A';
          if (cand.netRiskRewardRatio) {
            derivedRR = `${cand.netRiskRewardRatio.toFixed(2)}:1`;
          } else if (cand.entryPrice && cand.stopLoss && (cand.takeProfit || cand.tp1)) {
            const slDist = Math.abs(cand.entryPrice - cand.stopLoss);
            const tpDist = Math.abs((cand.tp1 || cand.takeProfit!) - cand.entryPrice);
            if (slDist > 0) {
              derivedRR = `${(tpDist / slDist).toFixed(2)}:1`;
            }
          }

          const mtfInfo = cand.mtfStatus || cand.stage || (cand.failedGates?.includes('MTF_ALIGNMENT') ? 'MTF Contradiction' : 'MTF Confluence Checked');

          return (
            <div
              key={cand.symbol || idx}
              className="bg-slate-900/90 border border-rose-900/50 hover:border-rose-700/80 rounded-xl p-3.5 space-y-2.5 transition shadow-md"
            >
              {/* Row 1: Symbol, Direction, Score */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white tracking-wide">{cand.symbol}</span>
                  {cand.direction && (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        cand.direction === 'BUY'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-rose-950 text-rose-400 border border-rose-800'
                      }`}
                    >
                      {cand.direction}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-bold">
                    Score: {scoreVal}/100
                  </span>
                </div>

                <div className="text-[10px] text-slate-400">
                  High-Score Candidate
                </div>
              </div>

              {/* Row 2: Prominent REJECTED — NOT TRADEABLE Status */}
              <div className="flex items-center justify-between gap-2 bg-rose-950/60 p-2 rounded-lg border border-rose-800/80">
                <div className="flex items-center gap-1.5 text-rose-300 font-bold text-[11px] tracking-wider uppercase">
                  <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>REJECTED — NOT TRADEABLE</span>
                </div>
                <span className="text-[9px] text-rose-400/80 font-sans italic">Action Blocked</span>
              </div>

              {/* Row 3: Primary Reason & Primary Failed Gate */}
              <div className="space-y-1 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 text-[11px] leading-relaxed">
                <div className="text-slate-200">
                  <span className="font-semibold text-rose-300">Reason: </span>
                  <span className="text-slate-300 font-sans">{reason}</span>
                </div>
                <div className="text-slate-300 pt-0.5">
                  <span className="font-semibold text-amber-300">Failed Gate: </span>
                  <span className="px-1.5 py-0.2 bg-rose-950 text-rose-300 rounded border border-rose-800 text-[10px] font-mono inline-block">
                    {primaryFailedGate}
                  </span>
                </div>
              </div>

              {/* Row 4: Expandable Details Toggle */}
              <div>
                <button
                  type="button"
                  id={`btn-expand-72plus-${cand.symbol}`}
                  onClick={() => toggleExpand(cand.symbol)}
                  className="w-full py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px] rounded-lg border border-slate-800 transition flex items-center justify-center gap-1.5 cursor-pointer font-mono"
                >
                  <span>{isExpanded ? 'Hide Setup Details' : 'Expand Setup Details'}</span>
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {/* Expanded Details Section */}
                {isExpanded && (
                  <div className="mt-2.5 p-3 bg-slate-950/90 border border-slate-800/90 rounded-xl space-y-2.5 text-[10px] animate-in fade-in duration-150">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <span className="text-slate-500 block text-[9px]">ENTRY PRICE</span>
                        <span className="text-slate-200 font-bold">{cand.entryPrice ?? 'N/A'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <span className="text-slate-500 block text-[9px]">STOP LOSS</span>
                        <span className="text-rose-400 font-bold">{cand.stopLoss ?? 'N/A'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <span className="text-slate-500 block text-[9px]">TAKE PROFIT (TP1)</span>
                        <span className="text-emerald-400 font-bold">{cand.tp1 ?? cand.takeProfit ?? 'N/A'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <span className="text-slate-500 block text-[9px]">RISK : REWARD</span>
                        <span className="text-blue-400 font-bold">{derivedRR}</span>
                      </div>
                    </div>

                    {(cand.tp2 !== undefined || cand.tp3 !== undefined) && (
                      <div className="grid grid-cols-2 gap-2">
                        {cand.tp2 !== undefined && (
                          <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                            <span className="text-slate-500 block text-[9px]">TP2 (EXTENDED)</span>
                            <span className="text-emerald-300 font-bold">{cand.tp2}</span>
                          </div>
                        )}
                        {cand.tp3 !== undefined && (
                          <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                            <span className="text-slate-500 block text-[9px]">TP3 (MAX TARGET)</span>
                            <span className="text-emerald-200 font-bold">{cand.tp3}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="bg-slate-900/80 p-2 rounded border border-slate-800 flex items-center justify-between">
                      <span className="text-slate-400 font-semibold">MTF Structure Status:</span>
                      <span className="text-slate-200">{mtfInfo}</span>
                    </div>

                    <RejectionBreakdown candidate={cand as any} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
