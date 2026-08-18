/**
 * Signal History & Audit Log Component
 *
 * Local state-based panel displaying the last 10 generated signals/alerts
 * with exact snapshot timestamps, directional bias, and execution outcomes.
 * Allows traders to review past setups even after they are superseded.
 */

import { useState, useEffect } from 'react';
import { SignalHistoryItem } from '../types/index.js';
import { formatTimeWithZone, DisplayTimeZone } from '../utils/time.js';
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
} from 'lucide-react';

interface SignalHistoryPanelProps {
  history: SignalHistoryItem[];
  onClearHistory: () => void;
  onDeleteHistoryItem?: (id: string, symbol: string) => void;
  preferredTimeZone: DisplayTimeZone;
  onSelectSymbol?: (symbol: string) => void;
}

export function SignalHistoryPanel({
  history,
  onClearHistory,
  onDeleteHistoryItem,
  preferredTimeZone,
  onSelectSymbol,
}: SignalHistoryPanelProps) {
  const [filter, setFilter] = useState<'ALL' | 'TOP_TRADE' | 'SUGGESTION'>('ALL');
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

  const filteredHistory = history.filter((item) => {
    if (filter === 'TOP_TRADE') return item.isTopTrade || item.outcomeType === 'TOP_TRADE';
    if (filter === 'SUGGESTION') return item.isSuggestion || item.outcomeType === 'SUGGESTION';
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-emerald-400">
            <History className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Signal History & Alert Log</h3>
              <span className="text-xs font-mono bg-slate-950 text-slate-300 px-2 py-0.5 rounded border border-slate-800">
                {history.length}/10 Archived
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Local session audit log of the last 10 generated signals and market scan outcomes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter Chips */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-mono">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`px-2 py-0.5 rounded transition ${
                filter === 'ALL'
                  ? 'bg-slate-800 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({history.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('TOP_TRADE')}
              className={`px-2 py-0.5 rounded transition ${
                filter === 'TOP_TRADE'
                  ? 'bg-amber-950 text-amber-300 font-semibold border border-amber-800'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Top ({history.filter((h) => h.isTopTrade).length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('SUGGESTION')}
              className={`px-2 py-0.5 rounded transition ${
                filter === 'SUGGESTION'
                  ? 'bg-sky-950 text-sky-300 font-semibold border border-sky-800'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Suggestions ({history.filter((h) => h.isSuggestion).length})
            </button>
          </div>

          {/* Clear History Button */}
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/60 text-slate-400 hover:text-rose-400 transition"
              title="Clear All Signal History"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* History List */}
      {filteredHistory.length > 0 ? (
        <div className="space-y-2.5">
          {filteredHistory.map((item) => {
            const isExpanded = expandedId === item.id;
            const precision = item.entryPrice && item.entryPrice < 10 ? 5 : 2;

            return (
              <div
                key={item.id}
                className="bg-slate-950 border border-slate-800/90 hover:border-slate-700/80 rounded-lg p-3 transition"
              >
                {/* Main Row */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  {/* Left: Direction, Symbol, Outcome Badge */}
                  <div className="flex flex-wrap items-center gap-2">
                    {item.direction === 'BUY' ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs font-mono font-bold flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> BUY
                      </span>
                    ) : item.direction === 'SELL' ? (
                      <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 text-xs font-mono font-bold flex items-center gap-1">
                        <TrendingDown className="w-3 h-3" /> SELL
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
                        {item.marketType}
                      </span>
                    )}

                    {item.marketRegime && (
                      <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800">
                        {item.marketRegime}
                      </span>
                    )}

                    {item.signalStatus ? (
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                          item.signalStatus === 'TP HIT'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                            : item.signalStatus === 'SL HIT'
                            ? 'bg-rose-950 text-rose-300 border-rose-500'
                            : item.signalStatus === 'EXPIRED'
                            ? 'bg-amber-950 text-amber-300 border-amber-600'
                            : item.signalStatus === 'INVALIDATED'
                            ? 'bg-slate-900 text-slate-400 border-slate-700'
                            : 'bg-blue-950 text-blue-300 border-blue-500'
                        }`}
                      >
                        {item.signalStatus}
                      </span>
                    ) : item.isBestTrade || item.rankTier === 'BEST_TRADE' || item.outcomeType === 'BEST_TRADE' ? (
                      <span className="text-[10px] font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2 py-0.5 rounded">
                        ★ BEST TRADE
                      </span>
                    ) : item.isSecondBest || item.rankTier === 'SECOND_BEST' || item.outcomeType === 'SECOND_BEST' ? (
                      <span className="text-[10px] font-mono font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-500/80 px-2 py-0.5 rounded">
                        ★ SECOND BEST
                      </span>
                    ) : item.isSuggestion || item.rankTier === 'SUGGESTION' || item.outcomeType === 'SUGGESTION' ? (
                      <span className="text-[10px] font-mono font-bold bg-sky-950/90 text-sky-300 border border-sky-600/80 px-2 py-0.5 rounded">
                        SUGGESTION
                      </span>
                    ) : item.isTopTrade ? (
                      <span className="text-[10px] font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2 py-0.5 rounded">
                        ★ TOP TRADE
                      </span>
                    ) : item.outcomeType === 'NO_TRADE_OPPORTUNITY' ? (
                      <span className="text-[10px] font-mono bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded">
                        NO VALID SETUP
                      </span>
                    ) : null}
                  </div>

                  {/* Center/Right: Numeric Prices, Meta & Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
                    {item.entryPrice !== undefined && item.entryPrice > 0 ? (
                      <div className="flex flex-wrap items-center gap-2 text-slate-300">
                        <span>
                          Entry: <strong className="text-white">{item.entryPrice.toFixed(precision)}</strong>
                        </span>
                        {item.takeProfit !== undefined && (
                          <span className="text-emerald-400 flex items-center gap-1.5 flex-wrap">
                            <span>TPs:</span>
                            <span className="bg-emerald-950/40 text-emerald-500 px-1 rounded font-medium" title="TP1 (Conservative)">T1:{(item.tp1 ?? item.takeProfit).toFixed(precision)}</span>
                            <span className="bg-emerald-950/40 text-emerald-400 px-1 rounded font-bold" title="TP2 (Main Target)">T2:{(item.tp2 ?? item.takeProfit).toFixed(precision)}</span>
                            <span className="bg-emerald-950/40 text-emerald-300 px-1 rounded font-medium" title="TP3 (Extended)">T3:{(item.tp3 ?? item.takeProfit).toFixed(precision)}</span>
                          </span>
                        )}
                        {item.stopLoss !== undefined && (
                          <span className="text-rose-400">
                            SL: {item.stopLoss.toFixed(precision)}
                          </span>
                        )}
                        {item.riskRewardRatio !== undefined && (
                          <span className="text-blue-400 font-semibold">
                            ({item.riskRewardRatio}:1 R:R)
                          </span>
                        )}
                      </div>
                    ) : null}

                    {item.score !== undefined && (
                      <span className="text-slate-400">
                        Score: <strong className="text-blue-400">{item.score}/100</strong>
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

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2 text-xs">
                    {item.strategy && (
                      <div className="text-slate-300 font-mono text-[11px]">
                        <span className="text-slate-500">Strategy:</span> {item.strategy}
                      </div>
                    )}

                    {item.reason && (
                      <div className="bg-slate-900/90 border border-slate-800 rounded p-2.5 text-slate-300 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[11px] mb-1">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                          <span>Evaluation Summary</span>
                        </div>
                        <p className="text-slate-300 leading-relaxed font-sans">{item.reason}</p>
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
                          Source: <strong className="text-slate-400">{item.dataSource}</strong>
                        </span>
                      )}
                      <span>
                        Status Outcome:{' '}
                        <strong className="text-emerald-400 font-semibold">
                          {item.outcomeType}
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
        <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-6 text-center text-slate-500">
          <History className="w-6 h-6 mx-auto mb-2 text-slate-600" />
          <p className="text-xs text-slate-400 font-medium">No Signal History Recorded</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Scanned setups and generated trading signals will automatically be archived in this local log.
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
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSingle}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-sm transition"
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
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearAll}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-sm transition"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-slate-900/95 border border-emerald-500/60 shadow-2xl rounded-xl p-4 text-xs font-sans text-white flex items-start justify-between gap-3 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="flex items-start gap-2.5">
            <div className="p-1 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-400 shrink-0 mt-0.5">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <p className="font-semibold text-emerald-300">{toast.title}</p>
              <p className="text-slate-300 text-[11px] mt-0.5 leading-normal">{toast.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
            title="Dismiss Notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
