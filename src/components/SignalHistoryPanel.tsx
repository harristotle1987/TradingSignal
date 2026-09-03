/**
 * Signal History & Audit Log Component
 *
 * Local state-based panel displaying the last 30 generated signals/alerts
 * with exact snapshot timestamps, directional bias, execution outcomes, and detailed metrics.
 * Consolidates all active validated signal data and historical audit logs.
 */

import { useState, useEffect } from 'react';
import { SignalHistoryItem, TradingSignal } from '../types/index.js';
import { TargetTracker } from './TargetTracker.js';
import { RejectionBreakdown, AcceptanceBreakdown } from './SignalAnalysisDetails.js';
import { formatTimeWithZone, DisplayTimeZone } from '../utils/time.js';
import {
  formatLabel,
  formatStrategy,
  formatStatus,
  formatRankTier,
  formatProviderName,
  getDynamicPrecision,
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
  RefreshCw,
  BarChart3,
  Copy,
  Check,
} from 'lucide-react';
import { SignalPerformanceChart } from './SignalPerformanceChart.js';


function CopySignalButton({ signal, precision }: { signal: any, precision: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: any) => {
    e.stopPropagation();
    
    let text = `Symbol: ${signal.symbol} (${signal.direction})\n`;
    text += `Entry: ${signal.entryPrice ? signal.entryPrice.toFixed(precision) : '--'}\n`;
    text += `Stop Loss: ${signal.stopLoss ? signal.stopLoss.toFixed(precision) : '--'}\n`;
    if (signal.tp1 !== undefined) {
      text += `TP1: ${signal.tp1.toFixed(precision)}\n`;
    }
    if (signal.tp2 !== undefined) {
      text += `TP2: ${signal.tp2.toFixed(precision)}\n`;
    }
    if (signal.tp3 !== undefined) {
      text += `TP3: ${signal.tp3.toFixed(precision)}\n`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded transition min-h-[28px] min-w-[28px] flex items-center justify-center shadow-sm ${
        copied 
          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 cursor-default' 
          : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer'
      }`}
      title="Copy Signal Details"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

interface SignalHistoryPanelProps {
  history: SignalHistoryItem[];
  rejected72PlusCandidates?: any[];
  onClearHistory: () => void;
  onDeleteHistoryItem?: (id: string, symbol: string) => void;
  onDeleteMultipleHistoryItems?: (ids: string[]) => Promise<void>;
  deletingIds?: string[];
  preferredTimeZone: DisplayTimeZone;
  onSelectSymbol?: (symbol: string) => void;
  onTimeZoneChange?: (tz: DisplayTimeZone) => void;
  onSignalRefreshed?: (updatedSignal: TradingSignal) => void;
}

export function SignalHistoryPanel({
  history,
  rejected72PlusCandidates = [],
  onClearHistory,
  onDeleteHistoryItem,
  onDeleteMultipleHistoryItems,
  deletingIds = [],
  preferredTimeZone,
  onSelectSymbol,
  onTimeZoneChange,
  onSignalRefreshed,
}: SignalHistoryPanelProps) {
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'TOP_TRADE' | 'SUGGESTION' | '72PLUS_REJECTED'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'chart'>('list');

  // State for confirmation modals and toast notifications
  const [itemToDelete, setItemToDelete] = useState<{ id: string; symbol: string } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState<boolean>(false);
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

  const activeCount = history.filter((item) => (item.isTradeableSignal === true && item.signalClassification === 'TRADEABLE') && (item.signalStatus === 'ACTIVE' || item.signalStatus === 'WAITING_ENTRY' || item.outcomeType === 'VALIDATED')).length;
  const topCount = history.filter((item) => (item.isTradeableSignal === true && item.signalClassification === 'TRADEABLE') && (item.isTopTrade || item.isBestTrade || item.outcomeType === 'TOP_TRADE' || item.outcomeType === 'BEST_TRADE')).length;
  const suggestionCount = history.filter((item) => (item.isTradeableSignal === true && item.signalClassification === 'TRADEABLE') && (item.isSuggestion || item.outcomeType === 'SUGGESTION')).length;

  const filteredHistory = history.filter((item) => {
    // GATE 79: Every user-facing trade signal MUST require isTradeableSignal === true and signalClassification === 'TRADEABLE'
    if (item.isTradeableSignal !== true || item.signalClassification !== 'TRADEABLE') return false;
    // GATE 64: NO_TRADE notifications and non-tradeable entries must NOT appear in this panel
    if (item.direction === 'NO_TRADE' || item.outcomeType === 'NO_TRADE_OPPORTUNITY') return false;
    if (filter === 'ACTIVE') return item.signalStatus === 'ACTIVE' || item.signalStatus === 'WAITING_ENTRY' || item.outcomeType === 'VALIDATED';
    if (filter === 'TOP_TRADE') return item.isTopTrade || item.isBestTrade || item.outcomeType === 'TOP_TRADE' || item.outcomeType === 'BEST_TRADE';
    if (filter === 'SUGGESTION') return item.isSuggestion || item.outcomeType === 'SUGGESTION';
    return true;
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleConfirmDeleteSingle = async () => {
    if (itemToDelete) {
      const target = itemToDelete;
      setItemToDelete(null);
      if (onDeleteHistoryItem) {
        try {
          await onDeleteHistoryItem(target.id, target.symbol);
          setToast({
            title: 'Entry Deleted',
            message: `Signal history entry for ${target.symbol} was deleted successfully.`,
          });
        } catch (err: any) {
          setToast({
            title: 'Deletion Failed',
            message: err.message || `Could not delete entry for ${target.symbol} due to a network or server error.`,
          });
        }
      }
    }
  };

  const handleConfirmClearAll = async () => {
    setConfirmClearAll(false);
    try {
      await onClearHistory();
      setToast({
        title: 'History Cleared',
        message: 'All signal history and audit log entries have been cleared successfully.',
      });
    } catch (err: any) {
      setToast({
        title: 'Clear History Failed',
        message: err.message || 'Could not clear history due to a server error.',
      });
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.length > 0) {
      if (onDeleteMultipleHistoryItems) {
        setConfirmBulkDelete(false);
        try {
          await onDeleteMultipleHistoryItems(selectedIds);
          setToast({
            title: 'Multiple Entries Deleted',
            message: `Successfully deleted ${selectedIds.length} signal history entries.`,
          });
          setSelectedIds([]);
        } catch (err: any) {
          setToast({
            title: 'Bulk Deletion Failed',
            message: err.message || 'Firestore or network error occurred during deletion.',
          });
        }
      }
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 sm:p-5 shadow-md space-y-3.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
            <History className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-semibold text-white truncate">Signal History & Alert Log</h3>
              <span className="text-[10px] sm:text-xs font-mono bg-slate-950 text-emerald-400 px-2 py-0.5 rounded border border-slate-800 shrink-0 font-bold">
                {history.length}/30 Logged
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              Session audit log of generated signals, active setups, and scan outcomes
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {/* Timezone Preference Switcher */}
          {onTimeZoneChange && (
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-mono">
              <span className="text-slate-400 px-1 hidden sm:inline font-medium">
                ZONE:
              </span>
              <button
                type="button"
                onClick={() => onTimeZoneChange('LOCAL')}
                className={`px-1.5 py-0.5 rounded transition ${
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
                className={`px-1.5 py-0.5 rounded transition ${
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
                className={`px-1.5 py-0.5 rounded transition ${
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
          <div className="flex flex-wrap items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-mono gap-0.5">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`px-2 py-0.5 rounded transition cursor-pointer ${
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
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
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
              className={`px-2 py-0.5 rounded transition cursor-pointer ${
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
              className={`px-2 py-0.5 rounded transition cursor-pointer ${
                filter === 'SUGGESTION'
                  ? 'bg-sky-950 text-sky-300 font-semibold border border-sky-800'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Suggestions ({suggestionCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('72PLUS_REJECTED')}
              className={`px-2 py-0.5 rounded transition cursor-pointer ${
                filter === '72PLUS_REJECTED'
                  ? 'bg-rose-950 text-rose-300 font-semibold border border-rose-800'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              70+ Rejected ({rejected72PlusCandidates.length})
            </button>
          </div>

          {/* Clear History Button */}
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/60 text-slate-400 hover:text-rose-400 transition min-h-[28px] min-w-[28px] flex items-center justify-center cursor-pointer shadow-sm"
              title="Clear All Signal History"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* History List or Chart */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('list')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition cursor-pointer ${
            activeTab === 'list'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Signal Logs ({history.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('chart')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition cursor-pointer ${
            activeTab === 'chart'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
          Historical Performance
        </button>
      </div>

      {activeTab === 'chart' ? (
        <SignalPerformanceChart refreshTrigger={history.length} />
      ) : filter === '72PLUS_REJECTED' ? (
        rejected72PlusCandidates.length > 0 ? (
          <div className="space-y-3 font-mono">
            {rejected72PlusCandidates.map((cand: any, idx: number) => (
              <div
                key={idx}
                className="bg-slate-950/90 border border-rose-900/60 hover:border-rose-800 rounded-xl p-4 transition shadow-md space-y-2.5"
              >
                {/* Header Row: Symbol, Direction, Status & Score */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold text-white">{cand.symbol}</span>
                    {cand.direction && (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          cand.direction === 'BUY'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {cand.direction}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800 text-xs font-bold tracking-wide">
                      STATUS: {cand.statusText || 'REJECTED — NOT TRADEABLE'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-amber-300 font-bold bg-amber-950 px-2 py-0.5 rounded text-xs border border-amber-800/80">
                      Score: {cand.score || cand.finalScore}/100
                    </span>
                    {cand.timestamp && (
                      <span className="text-xs text-slate-400">
                        {formatTimeWithZone(cand.timestamp, preferredTimeZone)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Setup Prices */}
                {(cand.entryPrice || cand.stopLoss || cand.takeProfit || cand.tp1) && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-slate-900/80 p-2 rounded-lg border border-slate-800 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[10px]">ENTRY</span>
                      <span className="text-slate-200 font-semibold">{cand.entryPrice ?? 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">STOP LOSS</span>
                      <span className="text-rose-400 font-semibold">{cand.stopLoss ?? 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">TP1</span>
                      <span className="text-emerald-400 font-semibold">{cand.tp1 ?? cand.takeProfit ?? 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">TP2</span>
                      <span className="text-emerald-400 font-semibold">{cand.tp2 ?? 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">TP3</span>
                      <span className="text-emerald-400 font-semibold">{cand.tp3 ?? 'N/A'}</span>
                    </div>
                  </div>
                )}

                 {/* Interactive Rejection Breakdown */}
                 <div className="pt-2">
                   <RejectionBreakdown candidate={cand as any} />
                 </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 bg-slate-950/60 rounded-xl border border-slate-800 text-slate-400 text-xs font-mono">
            No 70+ candidates have been rejected in recent scans.
          </div>
        )
      ) : filteredHistory.length > 0 ? (
        <div className="space-y-3">
          {/* Bulk Action Controls */}
          {onDeleteMultipleHistoryItems && (
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs shadow-inner">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white transition select-none">
                <input
                  type="checkbox"
                  checked={filteredHistory.length > 0 && selectedIds.length === filteredHistory.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(filteredHistory.map((item) => item.id));
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-900 cursor-pointer h-4 w-4"
                />
                <span className="font-mono text-[11px] font-bold tracking-wider">SELECT ALL ({filteredHistory.length})</span>
              </label>

              {selectedIds.length > 0 && (
                <button
                  type="button"
                  disabled={deletingIds.length > 0}
                  onClick={() => setConfirmBulkDelete(true)}
                  className={`px-2.5 py-1 rounded font-semibold font-mono text-[10px] tracking-wide transition shadow-sm flex items-center gap-1 shrink-0 ${
                    deletingIds.length > 0
                      ? 'bg-rose-900/50 text-slate-400 cursor-not-allowed'
                      : 'bg-rose-600 hover:bg-rose-500 text-white cursor-pointer'
                  }`}
                >
                  {deletingIds.length > 0 ? (
                    <RefreshCw className="w-3 h-3 animate-spin text-rose-300" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                  {deletingIds.length > 0 ? 'DELETING...' : `DELETE SELECTED (${selectedIds.length})`}
                </button>
              )}
            </div>
          )}

          {filteredHistory.map((item, idx) => {
            const isExpanded = expandedId === item.id;
            const precision = item.entryPrice ? getDynamicPrecision(item.entryPrice, item.symbol) : 2;
            const isDeleting = deletingIds.includes(item.id);

            // Determine custom visual statuses
            let customStatus: 'WAITING_ENTRY' | 'ACTIVE' | 'EXPIRING' | 'PROCESSING' | null = null;
            if (item.signalStatus === 'ACTIVE' || item.signalStatus === 'ENTRY_CONFIRMED' || item.signalStatus === 'CONFIRMED') {
              customStatus = 'ACTIVE';
            } else if (item.signalStatus === 'WAITING_ENTRY') {
              customStatus = 'WAITING_ENTRY';
            } else if (
              item.expiresAt && item.expiresAt - Date.now() > 0 && item.expiresAt - Date.now() < 30 * 60 * 1000
            ) {
              customStatus = 'EXPIRING';
            } else if (
              item.signalStatus === 'WATCHING' ||
              item.signalStatus === 'CANDIDATE' ||
              (item as any).status === 'PROCESSING'
            ) {
              customStatus = 'PROCESSING';
            }

            return (
              <div
                key={item.id || item.snapshotId || `${item.symbol}_${item.timestamp}`}
                className={`relative bg-slate-950/90 border border-slate-800/90 hover:border-slate-700 rounded-xl p-3 sm:p-4 transition shadow-md space-y-3 ${
                  isDeleting ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                {isDeleting && (
                  <div className="absolute inset-0 bg-slate-950/70 rounded-xl flex items-center justify-center z-10 backdrop-blur-[1px]">
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg shadow-xl">
                      <RefreshCw className="w-4 h-4 text-rose-400 animate-spin" />
                      <span className="text-xs font-mono font-bold text-slate-300">DELETING SIGNAL...</span>
                    </div>
                  </div>
                )}
                {/* Header Row: Symbol, Direction, Status & Badges */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                  {/* Left: Direction Badge, Symbol Name, Category & Status Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    {onDeleteMultipleHistoryItems && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds((prev) => [...prev, item.id]);
                          } else {
                            setSelectedIds((prev) => prev.filter((id) => id !== item.id));
                          }
                        }}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-900 cursor-pointer h-4 w-4 shrink-0 mr-1.5"
                      />
                    )}
                    {item.direction === 'BUY' ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] sm:text-xs font-mono font-bold flex items-center gap-1 shadow-sm">
                        <TrendingUp className="w-3.5 h-3.5" /> BUY
                      </span>
                    ) : item.direction === 'SELL' ? (
                      <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 text-[10px] sm:text-xs font-mono font-bold flex items-center gap-1 shadow-sm">
                        <TrendingDown className="w-3.5 h-3.5" /> SELL
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px] sm:text-xs font-mono font-semibold">
                        SCAN
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectSymbol && onSelectSymbol(item.symbol)}
                      className="text-lg sm:text-xl font-bold font-mono text-white hover:text-emerald-400 transition flex items-center gap-1 tracking-wide"
                      title={`Select ${item.symbol}`}
                    >
                      {item.symbol}
                      {onSelectSymbol && <ExternalLink className="w-3 h-3 opacity-70 text-slate-400" />}
                    </button>

                    {item.timeframe && (
                      <span className="text-[10px] sm:text-xs font-mono text-slate-200 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        {item.timeframe}
                      </span>
                    )}

                    {item.marketType && (
                      <span className="text-[10px] sm:text-xs font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                        {formatLabel(item.marketType)}
                      </span>
                    )}

                    {item.marketRegime && (
                      <span className="text-[10px] sm:text-xs font-mono text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800">
                        {formatLabel(item.marketRegime)}
                      </span>
                    )}

                    {customStatus === 'WAITING_ENTRY' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded border bg-blue-950/90 text-blue-300 border-blue-500/80 text-[10px] sm:text-xs font-mono font-bold shadow-[0_0_8px_rgba(59,130,246,0.15)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        WAITING ENTRY
                      </span>
                    ) : customStatus === 'ACTIVE' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-500 text-[10px] sm:text-xs font-mono font-bold shadow-[0_0_8px_rgba(16,185,129,0.1)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        ACTIVE
                      </span>
                    ) : customStatus === 'EXPIRING' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded border bg-amber-950/90 text-amber-300 border-amber-500/80 text-[10px] sm:text-xs font-mono font-bold shadow-[0_0_8px_rgba(245,158,11,0.1)] animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                        EXPIRING
                      </span>
                    ) : customStatus === 'PROCESSING' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded border bg-sky-950/90 text-sky-300 border-sky-500/80 text-[10px] sm:text-xs font-mono font-bold shadow-[0_0_8px_rgba(14,165,233,0.1)]">
                        <RefreshCw className="w-2.5 h-2.5 text-sky-400 animate-spin" />
                        PROCESSING
                      </span>
                    ) : item.signalStatus ? (
                      <span
                        className={`text-[10px] sm:text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                          item.signalStatus === 'ACTIVE'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                            : item.signalStatus === 'WAITING_ENTRY'
                            ? 'bg-blue-950 text-blue-300 border-blue-500'
                            : item.signalStatus === 'TP2_REACHED' || item.signalStatus === 'TP2_HIT'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                            : item.signalStatus === 'TP1_REACHED' || item.signalStatus === 'TP1_HIT'
                            ? 'bg-teal-950 text-teal-300 border-teal-600'
                            : item.signalStatus === 'STOPPED' || item.signalStatus === 'SL_HIT' || item.signalStatus === 'STOPPED_OUT'
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
                      <span className="text-[10px] sm:text-xs font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2 py-0.5 rounded">
                        {formatRankTier('BEST_TRADE', true)}
                      </span>
                    ) : item.isSecondBest || item.rankTier === 'SECOND_BEST' || item.outcomeType === 'SECOND_BEST' ? (
                      <span className="text-[10px] sm:text-xs font-mono font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-500/80 px-2 py-0.5 rounded">
                        {formatRankTier('SECOND_BEST', true)}
                      </span>
                    ) : item.isSuggestion || item.rankTier === 'SUGGESTION' || item.outcomeType === 'SUGGESTION' ? (
                      <span className="text-[10px] sm:text-xs font-mono font-bold bg-sky-950/90 text-sky-300 border border-sky-600/80 px-2 py-0.5 rounded">
                        {formatRankTier('SUGGESTION', false)}
                      </span>
                    ) : item.isTopTrade ? (
                      <span className="text-[10px] sm:text-xs font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2 py-0.5 rounded">
                        {formatRankTier('TOP_TRADE', true)}
                      </span>
                    ) : null}
                  </div>

                  {/* Right: Scores & Timestamps */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] sm:text-xs font-mono shrink-0">
                    {item.confidenceScore !== undefined && (
                      <span className="text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        Signal Score: <strong className="text-sky-400 font-bold">{item.confidenceScore}/100</strong>
                      </span>
                    )}

                    <span className="text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      Target Quality: <strong className="text-emerald-400 font-bold">{item.targetQualityScore !== undefined ? `${item.targetQualityScore}/100` : `${item.score || 72}/100`}</strong>
                    </span>

                    {(item.estimatedWinRate !== undefined || item.modelEstimatedWinRate !== undefined) && (
                      <span className="text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        Model Est. Win Rate: <strong className="text-emerald-400 font-bold">{(item.estimatedWinRate ?? item.modelEstimatedWinRate)?.toFixed(1)}%</strong>
                      </span>
                    )}

                    {item.isEmpiricallyCalibrated === true && item.empiricalProbability != null && (
                      <span className="text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-emerald-800/80">
                        Empirical Win Rate: <strong className="text-emerald-300 font-bold">{item.empiricalProbability.toFixed(1)}%</strong>
                        <span className="text-[9px] text-slate-400 ml-1">(N={item.probabilitySampleSize || '--'}{item.probabilityConfidenceInterval ? `, 95% CI: ${item.probabilityConfidenceInterval.lower.toFixed(1)}%–${item.probabilityConfidenceInterval.upper.toFixed(1)}%` : ''})</span>
                      </span>
                    )}

                    <span className="text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {formatTimeWithZone(item.timestamp, preferredTimeZone)}
                    </span>

                    {/* Expand Details Button */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(item.id)}
                      className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center shadow-sm"
                      title={isExpanded ? 'Collapse details' : 'Expand details'}
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    <CopySignalButton signal={item} precision={getDynamicPrecision(item.entryPrice, item.symbol)} />

                    {/* Delete Entry Button */}
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setItemToDelete({ id: item.id, symbol: item.symbol })}
                      className={`p-1 rounded transition min-h-[28px] min-w-[28px] flex items-center justify-center shadow-sm ${
                        isDeleting
                          ? 'bg-slate-900/50 text-slate-500 border-slate-900/50 cursor-not-allowed'
                          : 'bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-800/80 cursor-pointer'
                      }`}
                      title={isDeleting ? 'Deleting entry...' : `Delete entry for ${item.symbol}`}
                    >
                      {isDeleting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Single-Screen View Execution Price & Target Cards Grid */}
                {item.entryPrice !== undefined && item.entryPrice > 0 ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 font-mono">
                    {/* Entry Price Block */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 sm:p-3 space-y-1 flex flex-col justify-between shadow-sm">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                          EXACT ENTRY
                        </span>
                        <div className="text-base sm:text-xl font-bold text-white tracking-tight mt-0.5 truncate">
                          {item.entryPrice.toFixed(precision)}
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 block pt-1 border-t border-slate-800/80 truncate">
                        Market trigger
                      </span>
                    </div>

                    {/* Stop Loss Block */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 sm:p-3 space-y-1 flex flex-col justify-between shadow-sm">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                          STOP LOSS (ATR)
                        </span>
                        <div className="text-base sm:text-xl font-bold text-rose-400 tracking-tight mt-0.5 truncate">
                          {item.stopLoss?.toFixed(precision)}
                        </div>
                      </div>
                      {item.stopDistance !== undefined && item.pipPointUnit ? (
                        <div className="text-[10px] font-semibold text-rose-300 pt-1 border-t border-slate-800/80 truncate">
                          -{item.stopDistance} {item.pipPointUnit}
                        </div>
                      ) : (
                        <span className="text-[10px] text-rose-400/80 block pt-1 border-t border-slate-800/80 truncate">
                          Risk exit point
                        </span>
                      )}
                    </div>

                    {/* Take Profit Target Levels Block - Responsive 3-Col on Mobile */}
                    <div className="bg-slate-900/90 border border-emerald-900/60 rounded-lg p-2.5 sm:p-3 space-y-1.5 shadow-sm col-span-2 lg:col-span-1">
                      <div className="flex items-center justify-between pb-0.5 border-b border-emerald-950/80">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">
                          TAKE PROFIT TARGETS
                        </span>
                        <span className="text-[9px] text-emerald-400/80 bg-emerald-950 px-1 py-0.2 rounded font-mono">
                          Multi-Level
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-3 lg:grid-cols-1 gap-1 font-mono">
                        {/* TP1 */}
                        <div className="bg-slate-950/90 border border-emerald-900/50 p-1 sm:p-1.5 rounded flex flex-col lg:flex-row items-center justify-between gap-0.5 shadow-sm text-center lg:text-left">
                          <div>
                            <span className="text-[10px] font-bold text-emerald-400/90 block">TP1</span>
                            <span className="text-[8px] text-slate-400 hidden sm:block">Conservative</span>
                          </div>
                          <strong className="text-xs sm:text-sm font-bold text-emerald-400 tracking-tight">
                            {(item.tp1 ?? item.takeProfit)?.toFixed(precision)}
                          </strong>
                        </div>

                        {/* TP2 */}
                        <div className="bg-slate-950/90 border border-emerald-800/60 p-1 sm:p-1.5 rounded flex flex-col lg:flex-row items-center justify-between gap-0.5 shadow-sm text-center lg:text-left">
                          <div>
                            <span className="text-[10px] font-bold text-emerald-300 block">TP2</span>
                            <span className="text-[8px] text-slate-400 hidden sm:block">Main</span>
                          </div>
                          <strong className="text-xs sm:text-sm font-bold text-emerald-300 tracking-tight">
                            {(item.tp2 ?? item.takeProfit)?.toFixed(precision)}
                          </strong>
                        </div>

                        {/* TP3 */}
                        <div className="bg-slate-950/90 border border-emerald-700/60 p-1 sm:p-1.5 rounded flex flex-col lg:flex-row items-center justify-between gap-0.5 shadow-sm text-center lg:text-left">
                          <div>
                            <span className="text-[10px] font-bold text-emerald-200 block">TP3</span>
                            <span className="text-[8px] text-slate-400 hidden sm:block">Extended</span>
                          </div>
                          <strong className="text-xs sm:text-sm font-bold text-emerald-200 tracking-tight">
                            {(item.tp3 ?? item.takeProfit)?.toFixed(precision)}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Risk/Reward Ratio Block */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 sm:p-3 space-y-1 flex flex-col justify-between shadow-sm col-span-2 lg:col-span-1">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                          RISK / REWARD
                        </span>
                        <div className="text-base sm:text-xl font-bold text-blue-400 tracking-tight mt-0.5">
                          {item.riskRewardRatio}:1
                        </div>
                      </div>
                      {item.estimatedFriction?.netRiskRewardRatio ? (
                        <div className="text-[10px] font-semibold text-sky-300 pt-1 border-t border-slate-800/80 truncate">
                          Net: {item.estimatedFriction.netRiskRewardRatio.toFixed(2)}:1
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 block pt-1 border-t border-slate-800/80 truncate">
                          Gross setup
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="pt-3 border-t border-slate-800/80 space-y-3 text-xs">
                    {/* Gate 2 Authoritative Target Hit Details Tracker */}
                    <TargetTracker
                      signal={item as unknown as TradingSignal}
                      precision={precision}
                      onSignalRefreshed={onSignalRefreshed}
                    />

                    {item.strategy && (
                      <div className="text-slate-300 font-mono text-xs bg-slate-900/80 border border-slate-800 p-3 rounded-lg flex items-center gap-2">
                        <span className="text-slate-400 font-semibold uppercase text-[10px]">Strategy:</span>
                        <span className="text-white font-medium">{formatStrategy(item.strategy)}</span>
                      </div>
                    )}

                    {/* Technical Confluence Reasons List */}
                    {/* Visual Acceptance & Technical Confluence Breakdown */}
                    <AcceptanceBreakdown signal={item as any} />

                    {/* NVIDIA AI Risk Evaluation */}
                    {item.aiAssessment && (
                      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 text-slate-200 space-y-1.5">
                        <div className="flex items-center gap-2 text-cyan-400 font-semibold text-xs uppercase tracking-wider">
                          <Cpu className="w-4 h-4 text-emerald-400" />
                          <span>NVIDIA AI Risk Evaluation</span>
                        </div>
                        <p className="text-slate-200 leading-relaxed font-sans text-xs sm:text-sm">{item.aiAssessment}</p>
                      </div>
                    )}

                    {/* Evaluation Summary fallback */}
                    {item.reason && !item.aiAssessment && (
                      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 text-slate-200 space-y-1.5">
                        <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs uppercase tracking-wider">
                          <AlertCircle className="w-4 h-4 text-amber-400" />
                          <span>Evaluation Summary</span>
                        </div>
                        <p className="text-slate-200 leading-relaxed font-sans text-xs">{item.reason}</p>
                      </div>
                    )}

                    {/* Friction & Execution Specs */}
                    {item.estimatedFriction && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/90 p-3.5 rounded-xl border border-slate-800/80 font-mono text-xs text-slate-400">
                        {item.estimatedFriction.spreadPlusSlippage && (
                          <div className="flex justify-between items-center px-2 py-1 bg-slate-950/60 rounded border border-slate-800/50">
                            <span>Spread & Slippage:</span>
                            <strong className="text-slate-200">{item.estimatedFriction.spreadPlusSlippage}</strong>
                          </div>
                        )}
                        {item.estimatedFriction.frictionToProfitPct !== undefined && (
                          <div className="flex justify-between items-center px-2 py-1 bg-slate-950/60 rounded border border-slate-800/50">
                            <span>Friction Cost Ratio:</span>
                            <strong className="text-emerald-400">{item.estimatedFriction.frictionToProfitPct}%</strong>
                          </div>
                        )}
                        <div className="flex justify-between items-center px-2 py-1 bg-slate-950/60 rounded border border-slate-800/50">
                          <span>Execution Hurdle:</span>
                          <strong className="text-emerald-400">Passes Gate 9</strong>
                        </div>
                      </div>
                    )}

                    {/* Metadata Footer in Expanded Drawer */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
                      {item.snapshotId && (
                        <span>
                          Snapshot ID: <strong className="text-slate-300">{item.snapshotId}</strong>
                        </span>
                      )}
                      {item.dataSource && (
                        <span>
                          Source: <strong className="text-slate-300">{formatProviderName(item.dataSource)}</strong>
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

      {/* Confirmation Modal for Bulk Delete */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 bg-rose-950/60 border border-rose-800/80 rounded-lg shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Delete Selected Signals?</h4>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Are you sure you want to delete the <strong className="text-white font-mono">{selectedIds.length}</strong> selected signal history entries? This action is permanent and persistent.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-sm transition cursor-pointer"
              >
                Yes, Delete All {selectedIds.length}
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
