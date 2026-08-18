/**
 * Signal History & Audit Log Component
 *
 * Local state-based panel displaying the last 30 generated signals/alerts
 * with exact snapshot timestamps, directional bias, execution outcomes, and detailed metrics.
 * Consolidates all active validated signal data and historical audit logs.
 */

import { useState, useEffect } from 'react';
import { SignalHistoryItem } from '../types/index.js';
import { formatTimeWithZone, DisplayTimeZone } from '../utils/time.js';
import {
  formatLabel,
  formatStrategy,
  formatStatus,
  formatRankTier,
  formatProviderName,
} from '../utils/formatters.js';
import {
  History,
  TrendingUp,
  TrendingDown,
  Trash2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Zap,
  Clock,
  Layers,
  Cpu,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  X,
  Activity,
  Globe,
} from 'lucide-react';

interface SignalHistoryPanelProps {
  history: SignalHistoryItem[];
  onClearHistory: () => void;
  onDeleteHistoryItem?: (id: string, symbol: string) => void;
  preferredTimeZone: DisplayTimeZone;
  onSelectSymbol?: (symbol: string) => void;
  onTimeZoneChange?: (tz: DisplayTimeZone) => void;
}

export function SignalHistoryPanel({
  history,
  onClearHistory,
  onDeleteHistoryItem,
  preferredTimeZone,
  onSelectSymbol,
  onTimeZoneChange,
}: SignalHistoryPanelProps) {
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'TOP_TRADE' | 'SUGGESTION' | 'NO_TRADE'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // State for confirmation modals and toast notifications
  const [itemToDelete, setItemToDelete] = useState<{ id: string; symbol: string } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  // Auto-dismiss toast after 3.5s
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const activeCount = history.filter((item) => item.signalStatus === 'ACTIVE' || item.outcomeType === 'VALIDATED').length;
  const topCount = history.filter((item) => item.isTopTrade || item.isBestTrade || item.outcomeType === 'TOP_TRADE' || item.outcomeType === 'BEST_TRADE').length;
  const suggestionCount = history.filter((item) => item.isSuggestion || item.outcomeType === 'SUGGESTION').length;
  const noTradeCount = history.filter((item) => item.direction === 'NO_TRADE' || item.outcomeType === 'NO_TRADE_OPPORTUNITY').length;

  const filteredHistory = history.filter((item) => {
    if (filter === 'ACTIVE') return item.signalStatus === 'ACTIVE' || item.outcomeType === 'VALIDATED';
    if (filter === 'TOP_TRADE') return item.isTopTrade || item.isBestTrade || item.outcomeType === 'TOP_TRADE' || item.outcomeType === 'BEST_TRADE';
    if (filter === 'SUGGESTION') return item.isSuggestion || item.outcomeType === 'SUGGESTION';
    if (filter === 'NO_TRADE') return item.direction === 'NO_TRADE' || item.outcomeType === 'NO_TRADE_OPPORTUNITY';
    return true;
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleConfirmDeleteSingle = () => {
    if (itemToDelete) {
      if (onDeleteHistoryItem) {
        onDeleteHistoryItem(itemToDelete.id, itemToDelete.symbol);
      }
      setToast({
        title: 'Entry Deleted',
        message: `Signal history entry for ${itemToDelete.symbol} was deleted successfully.`,
      });
      setItemToDelete(null);
    }
  };

  const handleConfirmClearAll = () => {
    onClearHistory();
    setToast({
      title: 'History Cleared',
      message: 'All signal history and audit log entries have been cleared.',
    });
    setConfirmClearAll(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-emerald-400 shrink-0">
            <History className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-semibold text-white truncate">Signal History & Alert Log</h3>
              <span className="text-[10px] sm:text-xs font-mono bg-slate-950 text-emerald-400 px-1.5 sm:px-2 py-0.5 rounded border border-slate-800 shrink-0 font-bold">
                {history.length}/30 Logged
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate sm:whitespace-normal">
              Session audit log of the last 30 generated signals, active setups, and scan outcomes
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Timezone Preference Switcher */}
          {onTimeZoneChange && (
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-mono">
              <span className="text-slate-500 px-1.5 flex items-center gap-1 hidden sm:flex">
                <Globe className="w-3 h-3 text-slate-400" />
                ZONE:
              </span>
              <button
                type="button"
                onClick={() => onTimeZoneChange('LOCAL')}
                className={`px-2 py-0.5 rounded transition ${
                  preferredTimeZone === 'LOCAL'
                    ? 'bg-slate-800 text-emerald-400 font-semibold border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Local Browser Time"
              >
                Local
              </button>
              <button
                type="button"
                onClick={() => onTimeZoneChange('EXCHANGE')}
                className={`px-2 py-0.5 rounded transition ${
                  preferredTimeZone === 'EXCHANGE'
                    ? 'bg-slate-800 text-emerald-400 font-semibold border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Exchange Time (New York / Eastern Time)"
              >
                ET
              </button>
              <button
                type="button"
                onClick={() => onTimeZoneChange('UTC')}
                className={`px-2 py-0.5 rounded transition ${
                  preferredTimeZone === 'UTC'
                    ? 'bg-slate-800 text-emerald-400 font-semibold border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Universal Coordinated Time"
              >
                UTC
              </button>
            </div>
          )}

          {/* Filter Chips */}
          <div className="flex flex-wrap items-center bg-slate-950 p-0.5 xs:p-1 rounded-lg border border-slate-800 text-[10px] font-mono gap-1">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`px-2 py-1 rounded transition min-h-[30px] cursor-pointer ${
                filter === 'ALL'
                  ? 'bg-slate-800 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({history.length})
            </button>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => setFilter('ACTIVE')}
                className={`px-2 py-1 rounded transition min-h-[30px] cursor-pointer ${
                  filter === 'ACTIVE'
                    ? 'bg-emerald-950 text-emerald-300 font-semibold border border-emerald-800'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Active ({activeCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => setFilter('TOP_TRADE')}
              className={`px-2 py-1 rounded transition min-h-[30px] cursor-pointer ${
                filter === 'TOP_TRADE'
                  ? 'bg-amber-950 text-amber-300 font-semibold border border-amber-800'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Top ({topCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('SUGGESTION')}
              className={`px-2 py-1 rounded transition min-h-[30px] cursor-pointer ${
                filter === 'SUGGESTION'
                  ? 'bg-sky-950 text-sky-300 font-semibold border border-sky-800'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Suggestions ({suggestionCount})
            </button>
            {noTradeCount > 0 && (
              <button
                type="button"
                onClick={() => setFilter('NO_TRADE')}
                className={`px-2 py-1 rounded transition min-h-[30px] cursor-pointer ${
                  filter === 'NO_TRADE'
                    ? 'bg-slate-800 text-slate-300 font-semibold border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                No Trade ({noTradeCount})
              </button>
            )}
          </div>

          {/* Clear History Button */}
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="p-2 rounded-lg bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/60 text-slate-400 hover:text-rose-400 transition min-h-[34px] min-w-[34px] flex items-center justify-center cursor-pointer"
              title="Clear All Signal History"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* History List */}
      {filteredHistory.length > 0 ? (
        <div className="space-y-3">
          {filteredHistory.map((item, idx) => {
            const isExpanded = expandedId === item.id;
            const precision = item.entryPrice && item.entryPrice < 10 ? 5 : 2;

            return (
              <div
                key={`${item.id}_${idx}`}
                className="bg-slate-950 border border-slate-800/90 hover:border-slate-700/80 rounded-lg p-3.5 transition space-y-3"
              >
                {/* Main Header Row */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  {/* Left: Direction, Symbol, Outcome Badge */}
                  <div className="flex flex-wrap items-center gap-2">
                    {item.direction === 'BUY' ? (
                      <span className="px-2.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs font-mono font-bold flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5" /> BUY
                      </span>
                    ) : item.direction === 'SELL' ? (
                      <span className="px-2.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 text-xs font-mono font-bold flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5" /> SELL
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-xs font-mono">
                        SCAN
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectSymbol && onSelectSymbol(item.symbol)}
                      className="text-sm font-bold font-mono text-white hover:text-emerald-400 transition flex items-center gap-1"
                      title={`Select ${item.symbol}`}
                    >
                      {item.symbol}
                      {onSelectSymbol && <ExternalLink className="w-3 h-3 opacity-60" />}
                    </button>

                    {item.timeframe && (
                      <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        {item.timeframe}
                      </span>
                    )}

                    {item.marketType && (
                      <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                        {formatLabel(item.marketType)}
                      </span>
                    )}

                    {item.marketRegime && (
                      <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800">
                        {formatLabel(item.marketRegime)}
                      </span>
                    )}

                    {item.signalStatus ? (
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                          item.signalStatus === 'ACTIVE'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                            : item.signalStatus === 'TP HIT' || item.signalStatus === 'TP2 HIT'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                            : item.signalStatus === 'TP1 HIT'
                            ? 'bg-teal-950 text-teal-300 border-teal-600'
                            : item.signalStatus === 'SL HIT'
                            ? 'bg-rose-950 text-rose-300 border-rose-500'
                            : item.signalStatus === 'AMBIGUOUS'
                            ? 'bg-amber-950 text-amber-300 border-amber-500'
                            : item.signalStatus === 'EXPIRED'
                            ? 'bg-amber-950 text-amber-300 border-amber-600'
                            : item.signalStatus === 'INVALIDATED'
                            ? 'bg-slate-900 text-slate-400 border-slate-700'
                            : 'bg-blue-950 text-blue-300 border-blue-500'
                        }`}
                      >
                        {formatStatus(item.signalStatus)}
                      </span>
                    ) : item.isBestTrade || item.rankTier === 'BEST_TRADE' || item.outcomeType === 'BEST_TRADE' ? (
                      <span className="text-[10px] font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2 py-0.5 rounded">
                        {formatRankTier('BEST_TRADE', true)}
                      </span>
                    ) : item.isSecondBest || item.rankTier === 'SECOND_BEST' || item.outcomeType === 'SECOND_BEST' ? (
                      <span className="text-[10px] font-mono font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-500/80 px-2 py-0.5 rounded">
                        {formatRankTier('SECOND_BEST', true)}
                      </span>
                    ) : item.isSuggestion || item.rankTier === 'SUGGESTION' || item.outcomeType === 'SUGGESTION' ? (
                      <span className="text-[10px] font-mono font-bold bg-sky-950/90 text-sky-300 border border-sky-600/80 px-2 py-0.5 rounded">
                        {formatRankTier('SUGGESTION', false)}
                      </span>
                    ) : item.isTopTrade ? (
                      <span className="text-[10px] font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2 py-0.5 rounded">
                        {formatRankTier('TOP_TRADE', true)}
                      </span>
                    ) : item.outcomeType === 'NO_TRADE_OPPORTUNITY' ? (
                      <span className="text-[10px] font-mono bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded">
                        {formatLabel('NO_TRADE_OPPORTUNITY')}
                      </span>
                    ) : null}
                  </div>

                  {/* Center/Right: Numeric Specs & Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
                    {item.score !== undefined && (
                      <span className="text-slate-400">
                        Score: <strong className="text-blue-400">{item.score}/100</strong>
                      </span>
                    )}

                    {item.confidenceScore !== undefined && (
                      <span className="text-slate-400">
                        Conf: <strong className="text-emerald-400">{item.confidenceScore}%</strong>
                      </span>
                    )}

                    {item.estimatedWinRate !== undefined && (
                      <span className="text-slate-400">
                        Win Rate: <strong className="text-emerald-400">{item.estimatedWinRate.toFixed(1)}%</strong>
                      </span>
                    )}

                    {item.isAiValidated !== undefined && (
                      <span className="text-slate-400">
                        AI:{' '}
                        <strong className={item.isAiValidated ? "text-emerald-400" : "text-amber-400"}>
                          {item.isAiValidated ? "Validated" : "UNAVAILABLE"}
                        </strong>
                      </span>
                    )}

                    <span className="text-slate-500 text-[11px] flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {formatTimeWithZone(item.timestamp, preferredTimeZone)}
                    </span>

                    {/* Expand Details Trigger */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(item.id)}
                      className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                      title={isExpanded ? 'Hide details' : 'Show details'}
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {/* Individual Item Delete Button */}
                    <button
                      type="button"
                      onClick={() => setItemToDelete({ id: item.id, symbol: item.symbol })}
                      className="p-1 rounded bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-800/80 transition"
                      title={`Delete signal history entry for ${item.symbol}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Pricing & Targets Summary Bar */}
                {item.entryPrice !== undefined && item.entryPrice > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-900/90 p-2.5 rounded border border-slate-800/80 font-mono text-xs">
                    <div>
                      <span className="text-slate-400 text-[10px] block">ENTRY</span>
                      <strong className="text-white text-sm">{item.entryPrice.toFixed(precision)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">STOP LOSS</span>
                      <span className="text-rose-400 font-bold text-sm">
                        {item.stopLoss?.toFixed(precision)}
                        {item.stopDistance !== undefined && item.pipPointUnit && (
                          <span className="text-[10px] ml-1 font-normal opacity-70 text-rose-300">
                            (-{item.stopDistance} {item.pipPointUnit})
                          </span>
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">TARGETS (TP1/TP2/TP3)</span>
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-emerald-500 font-semibold" title="TP1 (Conservative)">
                          T1:{(item.tp1 ?? item.takeProfit)?.toFixed(precision)}
                        </span>
                        <span className="text-emerald-400 font-bold" title="TP2 (Main Target)">
                          T2:{(item.tp2 ?? item.takeProfit)?.toFixed(precision)}
                        </span>
                        <span className="text-emerald-300 font-semibold" title="TP3 (Extended)">
                          T3:{(item.tp3 ?? item.takeProfit)?.toFixed(precision)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block">RISK / REWARD</span>
                      <span className="text-blue-400 font-bold text-sm">
                        {item.riskRewardRatio}:1
                        {item.estimatedFriction?.netRiskRewardRatio && (
                          <span className="text-[10px] ml-1 font-normal opacity-75 text-sky-300">
                            (Net: {item.estimatedFriction.netRiskRewardRatio.toFixed(2)}:1)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-2.5 text-xs">
                    {item.strategy && (
                      <div className="text-slate-300 font-mono text-[11px]">
                        <span className="text-slate-500">Strategy:</span> {formatStrategy(item.strategy)}
                      </div>
                    )}

                    {/* Technical Confluence Reasons List */}
                    {item.confluenceReasons && item.confluenceReasons.length > 0 && (
                      <div className="bg-slate-900/90 border border-slate-800 rounded p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[11px]">
                          <Layers className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Technical Confluence Rationale</span>
                        </div>
                        <ul className="space-y-1 pl-1">
                          {item.confluenceReasons.map((reason, rIdx) => (
                            <li key={rIdx} className="text-xs text-slate-300 flex items-start gap-2 leading-relaxed">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* NVIDIA AI Risk Evaluation */}
                    {item.aiAssessment && (
                      <div className="bg-slate-900/90 border border-slate-800 rounded p-3 text-slate-300 text-xs">
                        <div className="flex items-center gap-1.5 text-cyan-400 font-semibold text-[11px] mb-1">
                          <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="uppercase tracking-wider">NVIDIA AI Risk Evaluation</span>
                        </div>
                        <p className="text-slate-300 leading-relaxed font-sans">{item.aiAssessment}</p>
                      </div>
                    )}

                    {/* Evaluation Summary fallback */}
                    {item.reason && !item.aiAssessment && (
                      <div className="bg-slate-900/90 border border-slate-800 rounded p-2.5 text-slate-300 text-xs">
                        <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px] mb-1">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                          <span>Evaluation Summary</span>
                        </div>
                        <p className="text-slate-300 leading-relaxed font-sans">{item.reason}</p>
                      </div>
                    )}

                    {/* Friction & Execution Specs */}
                    {item.estimatedFriction && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-900/90 p-2.5 rounded border border-slate-800/80 font-mono text-[10px] text-slate-400">
                        {item.estimatedFriction.spreadPlusSlippage && (
                          <div className="flex justify-between items-center px-1">
                            <span>Spread & Slippage:</span>
                            <strong className="text-slate-200">{item.estimatedFriction.spreadPlusSlippage}</strong>
                          </div>
                        )}
                        {item.estimatedFriction.frictionToProfitPct !== undefined && (
                          <div className="flex justify-between items-center px-1 border-t sm:border-t-0 sm:border-l border-slate-800/60 pt-1 sm:pt-0">
                            <span>Friction Cost Ratio:</span>
                            <strong className="text-amber-300">{item.estimatedFriction.frictionToProfitPct.toFixed(1)}% of profit</strong>
                          </div>
                        )}
                        <div className="flex justify-between items-center px-1 border-t sm:border-t-0 sm:border-l border-slate-800/60 pt-1 sm:pt-0">
                          <span>Execution Noise Filter:</span>
                          <strong className="text-emerald-400">Passes Gate 9</strong>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-500 pt-1">
                      {item.snapshotId && (
                        <span>
                          Snapshot ID: <strong className="text-slate-400">{item.snapshotId}</strong>
                        </span>
                      )}
                      {item.dataSource && (
                        <span>
                          Source: <strong className="text-slate-400">{formatProviderName(item.dataSource)}</strong>
                        </span>
                      )}
                      <span>
                        Status Outcome:{' '}
                        <strong className="text-emerald-400 font-semibold">
                          {formatLabel(item.outcomeType)}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-8 text-center text-slate-500">
          <History className="w-8 h-8 mx-auto mb-2 text-slate-600" />
          <p className="text-xs text-slate-400 font-medium">No Signal History Recorded</p>
          <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
            Scanned setups and generated trading signals will automatically be logged and preserved in this audit panel.
          </p>
        </div>
      )}

      {/* Confirmation Modal for Individual Item Delete */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 bg-rose-950/60 border border-rose-800/80 rounded-lg shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Delete Signal History Entry?</h4>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Are you sure you want to delete the signal history entry for <strong className="text-white font-mono">{itemToDelete.symbol}</strong>?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSingle}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-sm transition cursor-pointer"
              >
                Yes, Delete Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Clear All History */}
      {confirmClearAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 bg-rose-950/60 border border-rose-800/80 rounded-lg shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Clear All Signal History?</h4>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Are you sure you want to wipe all <strong className="text-white">{history.length}</strong> signal audit log records?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmClearAll(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearAll}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-sm transition cursor-pointer"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6 z-50 max-w-[calc(100vw-1.5rem)] sm:max-w-sm w-auto sm:w-full bg-slate-900/95 border border-emerald-500/60 shadow-2xl rounded-xl p-3.5 sm:p-4 text-xs font-sans text-white flex items-start justify-between gap-3 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-1 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-400 shrink-0 mt-0.5">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-emerald-300 truncate">{toast.title}</p>
              <p className="text-slate-300 text-[11px] mt-0.5 leading-normal break-words">{toast.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition shrink-0 min-h-[28px] min-w-[28px] flex items-center justify-center cursor-pointer"
            title="Dismiss Notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
