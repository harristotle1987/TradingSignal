import React, { useState } from 'react';
import {
  TrendingUp,
  Activity,
  Layers,
  Volume2,
  Compass,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Flame,
  ArrowUpRight,
  ShieldAlert,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

// =========================================================================
// TYPES
// =========================================================================

interface ScoreFactors {
  trendAlignment?: number;
  mtfConfirmation?: number;
  momentum?: number;
  marketStructure?: number;
  volumeLiquidity?: number;
  volatilityAtrQuality?: number;
  entryQuality?: number;
  rrQuality?: number;
  executionQuality?: number;
  directionConfidence?: number;
}

interface RejectedCandidate {
  symbol: string;
  direction?: 'BUY' | 'SELL';
  score?: number;
  finalScore?: number;
  primaryRejectionReason: string;
  rejectionSummary?: string;
  failedGates?: string[];
  stage?: string;
  factors?: ScoreFactors;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  timestamp?: number;
}

interface AcceptedSignal {
  symbol: string;
  direction: 'BUY' | 'SELL';
  score?: number;
  confidenceScore?: number;
  strategy?: string;
  selectedStrategy?: string;
  marketRegime?: string;
  estimatedWinRate?: number;
  riskRewardRatio?: number;
  netRiskRewardRatio?: number;
  adverseNetRiskRewardRatio?: number;
  confluenceReasons?: string[];
  targetDistance?: number;
  stopDistance?: number;
  suggestedRiskAmount?: number;
  suggestedPositionSize?: number;
  aiAssessment?: string;
}

// =========================================================================
// HELPER FOR EXPLAINING THE 10 SCORE FACTORS
// =========================================================================
export const FACTOR_DESCRIPTIONS: Record<string, { label: string; max: number; desc: string }> = {
  trendAlignment: {
    label: 'Trend Alignment & Stack',
    max: 20,
    desc: 'Verifies the multi-timeframe EMA stack (20/50/200) to confirm trading in alignment with the macro momentum.',
  },
  mtfConfirmation: {
    label: 'Multi-TF Confluence',
    max: 15,
    desc: 'Analyzes consensus across 5m, 15m, 1h, and 4h timeframes to ensure a clean multi-dimensional trade flow.',
  },
  momentum: {
    label: 'Momentum Strength',
    max: 10,
    desc: 'Evaluates RSI, MACD, and stochastic signals to verify directional velocity and avoid buying overextended reversals.',
  },
  marketStructure: {
    label: 'Market Structure & Level Displacement',
    max: 15,
    desc: 'Measures structural breaks (BOS/CHoCH) and the presence of material level displacement to confirm institutional flow.',
  },
  volumeLiquidity: {
    label: 'Volume Flow & Order Book Liquidity',
    max: 15,
    desc: 'Assesses order book depth, trading volume surges, and transaction flow to guarantee high execution fill rates.',
  },
  volatilityAtrQuality: {
    label: 'ATR & Volatility State',
    max: 10,
    desc: 'Evaluates Volatility and ATR relative expansion to verify the presence of an active, highly healthy market cycle.',
  },
  entryQuality: {
    label: 'Entry Setup Precision',
    max: 5,
    desc: 'Measures proximity to dynamic support/resistance zones, avoiding overbought chasing or late-trend entries.',
  },
  rrQuality: {
    label: 'Risk-to-Reward Ratio',
    max: 5,
    desc: 'Calculates structural risk relative to target reward. Requires an optimal balance with minimal safety buffer.',
  },
  executionQuality: {
    label: 'Execution Cost resilience',
    max: 5,
    desc: 'Stress tests the target setup against slippage, bid-ask spreads, and potential trading fees before execution.',
  },
  directionConfidence: {
    label: 'Strategy Consensus Agreement',
    max: 5,
    desc: 'Measures how many independent mathematical strategies agree on the directional outcome.',
  },
};

// =========================================================================
// HELPER FOR EXPLAINING GATES / CHECKS
// =========================================================================
export const GATE_EXPLANATIONS: Record<string, { title: string; desc: string }> = {
  FRESH_MARKET_DATA: {
    title: 'Fresh Market Data Check',
    desc: 'Validates that the received market data is live (less than 3 minutes old) to avoid trading on stale quotes.',
  },
  VALID_ENTRY: {
    title: 'Valid Current Entry Price',
    desc: 'Confirms that the market entry price is stable, non-zero, and has not excessively drifted from the trigger point.',
  },
  SL_TP_VALIDITY: {
    title: 'Stop-Loss & Take-Profit Sanity',
    desc: 'Ensures that stop-loss is placed in the correct direction (below entry for buy, above for sell) and take-profits are sequentially ordered.',
  },
  RR: {
    title: 'Minimum acceptable Risk/Reward Ratio',
    desc: 'Strictly enforces that the gross risk-to-reward ratio meets the system-wide safety threshold (minimum 1.8:1).',
  },
  COOLDOWN: {
    title: 'Asset and Strategy Cooldown',
    desc: 'Prevents over-exposure by enforcing a pause duration after similar signals have been generated for this specific asset.',
  },
  DUPLICATE_OR_EXISTING_SIGNAL: {
    title: 'No Conflicting Signal Check',
    desc: 'Blocks duplicate signals if an identical trade setup is already active or was recently dispatched.',
  },
  MARKET_SESSION_STATUS: {
    title: 'Market Session Status',
    desc: 'Ensures that the asset category is currently open for trading (e.g. preventing Forex/Stock execution on weekends).',
  },
  WIN_RATE_BELOW_THRESHOLD: {
    title: 'Win Probability Safeguard',
    desc: 'Blocks setups where the mathematical probability of reaching the target levels is too low based on historical context.',
  },
  NEGATIVE_EXPECTANCY: {
    title: 'Positive Expectancy Threshold',
    desc: 'Confirms that the statistical expectancy per trade is positive, avoiding setups that are long-term loss-making.',
  },
  SIGNAL_CAP_EXCEEDED: {
    title: 'Portfolio Signal Cap',
    desc: 'Enforces risk limits by capping the maximum number of simultaneous open positions allowed to run.',
  },
  MARKET_STRUCTURE: {
    title: 'Market Structure Filter',
    desc: 'Rejects entries that are placed directly into heavy historical order blocks or major dynamic resistance lines.',
  },
};

// =========================================================================
// COMPONENT 1: REJECTION BREAKDOWN (REJECTED SIGNALS)
// =========================================================================
export const RejectionBreakdown: React.FC<{ candidate: RejectedCandidate }> = ({ candidate }) => {
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  const scoreVal = candidate.score ?? candidate.finalScore ?? 0;
  const factors = candidate.factors;

  // Determine which standard gates were flagged
  const failedGatesList = candidate.failedGates || [];

  return (
    <div className="space-y-4">
      {/* Title & Status Banner */}
      <div className="flex items-start justify-between gap-3 bg-rose-950/20 border border-rose-900/40 p-3 rounded-xl">
        <div className="space-y-1">
          <h4 className="text-rose-400 font-bold text-xs uppercase tracking-wide flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Detailed Rejection Analysis</span>
          </h4>
          <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
            This asset qualified as a high-score candidate ({scoreVal}/100) but was strictly rejected during deep-dive validation to protect capital.
          </p>
        </div>
        <div className="bg-rose-950 text-rose-300 font-mono text-[10px] font-bold px-2 py-1 rounded border border-rose-800/60 uppercase shrink-0">
          REJECTED
        </div>
      </div>

      {/* 1. Primary Failure Diagnosis */}
      <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800/80 space-y-2">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold font-mono">
          System Core Diagnosis
        </span>
        <div className="flex gap-2">
          <XCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="text-xs text-rose-300 font-medium font-sans leading-relaxed">
              {candidate.primaryRejectionReason}
            </p>
            {candidate.rejectionSummary && (
              <p className="text-[11px] text-slate-400 italic">
                Summary: {candidate.rejectionSummary}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 2. Visual 10-Factor Rubric (If available) */}
      {factors && Object.keys(factors).length > 0 ? (
        <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-850 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold font-mono">
              10-Factor Tradeability Rubric
            </span>
            <span className="text-[10px] text-amber-300 font-bold">
              Aggregate Score: {scoreVal}/100
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(factors).map(([key, rawScore]) => {
              const meta = FACTOR_DESCRIPTIONS[key];
              if (!meta) return null;
              const val = Number(rawScore) || 0;
              const pct = (val / meta.max) * 100;

              // Color coding based on score ratio
              let barColor = 'bg-rose-600';
              let textColor = 'text-rose-400';
              if (pct >= 80) {
                barColor = 'bg-emerald-500';
                textColor = 'text-emerald-400';
              } else if (pct >= 50) {
                barColor = 'bg-amber-500';
                textColor = 'text-amber-400';
              }

              const isFailingFactor = pct < 50;

              return (
                <div
                  key={key}
                  className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-900 flex flex-col gap-1.5 hover:border-slate-800 transition"
                >
                  <div className="flex items-center justify-between gap-1 text-[11px]">
                    <span className="text-slate-200 font-medium flex items-center gap-1">
                      {meta.label}
                      <button
                        type="button"
                        onClick={() => setShowTooltip(showTooltip === key ? null : key)}
                        className="text-slate-500 hover:text-slate-300 focus:outline-none"
                      >
                        <HelpCircle className="w-3 h-3" />
                      </button>
                    </span>
                    <span className={`font-mono font-bold ${textColor}`}>
                      {val.toFixed(1)} / {meta.max}
                    </span>
                  </div>

                  {/* Horizontal Bar */}
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>

                  {/* Tooltip Description */}
                  {showTooltip === key && (
                    <p className="text-[9.5px] text-slate-400 bg-slate-900/90 p-2 rounded border border-slate-800 mt-1 leading-normal font-sans">
                      {meta.desc}
                    </p>
                  )}

                  {isFailingFactor && (
                    <div className="text-[9px] text-rose-400/90 flex items-center gap-1 italic">
                      <AlertCircle className="w-2.5 h-2.5" />
                      <span>Sub-threshold performance</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Fallback explaining why factors aren't shown */
        <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-900 text-[10px] text-slate-400 leading-normal font-sans italic">
          Rubric factors are fully modeled when the candidate survives preliminary Stage 1 & Stage 2 scanners and reaches the Gate 8 soft-rule scoring process.
        </div>
      )}

      {/* 3. Flagged Safety Gates Checklist */}
      {failedGatesList.length > 0 && (
        <div className="bg-slate-900/20 p-3 rounded-xl border border-slate-850 space-y-2.5">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold font-mono">
            Triggered Safety Gate Definitions
          </span>
          <div className="space-y-2">
            {failedGatesList.map((gate) => {
              const expl = GATE_EXPLANATIONS[gate] || {
                title: `${gate.replace(/_/g, ' ')}`,
                desc: 'Capital protection hurdle designed to eliminate setups carrying heightened correlation, decay, or execution risks.',
              };

              return (
                <div key={gate} className="bg-rose-950/10 border border-rose-900/20 p-2 rounded-lg flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="text-xs text-rose-300 font-bold font-mono uppercase tracking-wide">
                      {expl.title}
                    </span>
                    <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                      {expl.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// =========================================================================
// COMPONENT 2: ACCEPTANCE BREAKDOWN (ACCEPTED / DISPATCHED SIGNALS)
// =========================================================================
export const AcceptanceBreakdown: React.FC<{ signal: AcceptedSignal }> = ({ signal }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const score = signal.score ?? signal.confidenceScore ?? 70;
  const winRate = signal.estimatedWinRate ?? 60;
  const rr = signal.riskRewardRatio ?? 1.8;

  // Derive rating classification based on score
  let rating = 'Standard';
  let ratingColor = 'text-emerald-400 bg-emerald-950/80 border border-emerald-800';
  if (score >= 90) {
    rating = 'EXCEPTIONAL';
    ratingColor = 'text-cyan-400 bg-cyan-950/80 border border-cyan-800 animate-pulse';
  } else if (score >= 85) {
    rating = 'VERY STRONG';
    ratingColor = 'text-indigo-400 bg-indigo-950/80 border border-indigo-800';
  } else if (score >= 80) {
    rating = 'STRONG';
    ratingColor = 'text-emerald-400 bg-emerald-950/80 border border-emerald-800';
  }

  return (
    <div className="space-y-3.5">
      {/* Visual Confluence Score & Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Metric 1: Composite Score */}
        <div className="bg-slate-900/85 border border-slate-800 rounded-xl p-3 flex flex-col justify-between hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider font-mono">
              Composite Score
            </span>
            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${ratingColor}`}>
              {rating}
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-2">
            <span className="text-2xl font-black text-white font-mono">{score}</span>
            <span className="text-xs text-slate-500">/100</span>
          </div>
          <div className="w-full bg-slate-950 rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className={`h-full ${score >= 85 ? 'bg-cyan-400' : 'bg-emerald-500'}`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>

        {/* Metric 2: Win Probability */}
        <div className="bg-slate-900/85 border border-slate-800 rounded-xl p-3 flex flex-col justify-between hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider font-mono">
              Win Probability
            </span>
            <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-1 mt-2">
            <span className="text-2xl font-black text-amber-300 font-mono">{winRate.toFixed(1)}</span>
            <span className="text-xs text-amber-500 font-bold">%</span>
          </div>
          <p className="text-[9.5px] text-slate-400 leading-normal font-sans mt-1">
            Empirically calibrated probability model based on strategy agreement.
          </p>
        </div>

        {/* Metric 3: Risk to Reward */}
        <div className="bg-slate-900/85 border border-slate-800 rounded-xl p-3 flex flex-col justify-between hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider font-mono">
              Risk : Reward
            </span>
            <ArrowUpRight className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-1 mt-2">
            <span className="text-2xl font-black text-emerald-400 font-mono">{rr.toFixed(2)}</span>
            <span className="text-xs text-slate-500 font-bold">:1</span>
          </div>
          <p className="text-[9.5px] text-slate-400 leading-normal font-sans mt-1">
            Expected reward to structural risk. Evaluated on TP2 level.
          </p>
        </div>
      </div>

      {/* Rationale Checklist and Confluence Items */}
      {signal.confluenceReasons && signal.confluenceReasons.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between text-xs text-slate-300 font-mono uppercase tracking-wider font-bold focus:outline-none"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Technical Confluence Breakdown ({signal.confluenceReasons.length})</span>
            </span>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {(!isExpanded || true) && (
            <ul className="space-y-1.5 pl-0.5">
              {signal.confluenceReasons.slice(0, isExpanded ? undefined : 3).map((reason, idx) => {
                // Classify icon type based on content text to add maximum visual logic
                let icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />;
                if (reason.toLowerCase().includes('trend') || reason.toLowerCase().includes('ema')) {
                  icon = <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />;
                } else if (reason.toLowerCase().includes('momentum') || reason.toLowerCase().includes('rsi')) {
                  icon = <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />;
                } else if (reason.toLowerCase().includes('volume') || reason.toLowerCase().includes('flow')) {
                  icon = <Volume2 className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />;
                } else if (reason.toLowerCase().includes('regime') || reason.toLowerCase().includes('breakout')) {
                  icon = <Compass className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />;
                }

                return (
                  <li
                    key={idx}
                    className="bg-slate-950/60 hover:bg-slate-950 border border-slate-900 hover:border-slate-800 p-2 rounded-lg flex items-start gap-2.5 text-xs text-slate-200 transition font-sans leading-relaxed"
                  >
                    {icon}
                    <span>{reason}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {!isExpanded && signal.confluenceReasons.length > 3 && (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="w-full text-center py-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-900 text-[10px] font-mono text-slate-400 hover:text-slate-200 rounded transition cursor-pointer"
            >
              Show All {signal.confluenceReasons.length} Confluences...
            </button>
          )}
        </div>
      )}
    </div>
  );
};
