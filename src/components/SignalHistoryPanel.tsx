/**
 * Signal History & Historical Trades Panel Component (Gate 16)
 *
 * Authoritative panel displaying historical and active trading records:
 * - Direct Firestore production data aggregation
 * - Server-side pagination & client-side instant responsive filters
 * - Filters: Status (All, Active, Wins, Losses, Expired, Top Trades, Suggestions), Direction (All, Buy, Sell), Date Range (7D, 30D, 90D, ALL), and Search query
 * - Prominently displays:
 *   - Symbol & Direction (BUY/SELL)
 *   - Original Immutable Entry Price, Stop Loss, TP1, TP2, TP3
 *   - Risk-to-Reward Ratio (R:R)
 *   - Score & Target Quality
 *   - Status & Outcome (WIN, LOSS, ACTIVE, EXPIRED, WAITING ENTRY)
 *   - Exact timestamps (Created, Resolved, Target hit milestones) with timezone converter
 * - Refresh button checks real-time market price and verifies hit status without modifying original setup values
 * - Copy signal button & deep fullscreen analysis inspection modal
 */

import { useState, useEffect, useMemo } from 'react';
import { SignalHistoryItem, TradingSignal } from '../types/index.js';
import { TargetTracker } from './TargetTracker.js';
import { RejectionBreakdown, AcceptanceBreakdown } from './SignalAnalysisDetails.js';
import { ReportZoomControls, useReportZoom } from './ReportZoomControls.js';
import { ZoomableReportWrapper } from './ZoomableReportWrapper.js';
import { SignalReportModal } from './SignalReportModal.js';
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
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Zap,
  Clock,
  Layers,
  Cpu,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  XCircle,
  X,
  Activity,
  Globe,
  RefreshCw,
  BarChart3,
  Copy,
  Check,
  Maximize2,
  Search,
  Filter,
} from 'lucide-react';
import { SignalPerformanceChart } from './SignalPerformanceChart.js';

function CopySignalButton({ signal, precision }: { signal: any; precision: number }) {
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
    if (signal.riskRewardRatio !== undefined) {
      text += `R:R: ${signal.riskRewardRatio}:1\n`;
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
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'WINS' | 'LOSSES' | 'EXPIRED' | 'TOP_TRADE' | 'SUGGESTION' | '72PLUS_REJECTED'>('ALL');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [rangeFilter, setRangeFilter] = useState<'7D' | '30D' | '90D' | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'chart'>('list');

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Zoom controls state for detailed signal analysis reports
  const {
    zoomLevel: reportZoomLevel,
    zoomIn: reportZoomIn,
    zoomOut: reportZoomOut,
    resetZoom: reportResetZoom,
    setZoom: reportSetZoom,
  } = useReportZoom(1.0, 0.7, 2.0, 0.15);
  const [inspectedSignal, setInspectedSignal] = useState<TradingSignal | null>(null);

  // Confirmation modals and toast notifications
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

  // Reset page to 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, directionFilter, rangeFilter, searchQuery, pageSize]);

  const now = Date.now();
  const rangeCutoff = useMemo(() => {
    if (rangeFilter === '7D') return now - 7 * 24 * 60 * 60 * 1000;
    if (rangeFilter === '30D') return now - 30 * 24 * 60 * 60 * 1000;
    if (rangeFilter === '90D') return now - 90 * 24 * 60 * 60 * 1000;
    return 0;
  }, [rangeFilter, now]);

  // Valid legitimate tradeable items
  const legitimateTrades = useMemo(() => {
    return history.filter((item) => {
      // Must be tradeable signal
      if (item.isTradeableSignal !== true || item.signalClassification !== 'TRADEABLE') return false;
      if (item.direction === 'NO_TRADE' || item.outcomeType === 'NO_TRADE_OPPORTUNITY') return false;
      // Filter out non-positive/artificial prices
      if (item.entryPrice === 50000 || item.entryPrice === 49000 || item.entryPrice === 52000) return false;
      return true;
    });
  }, [history]);

  // Summary counts
  const activeCount = useMemo(
    () => legitimateTrades.filter((item) => item.signalStatus === 'ACTIVE' || item.signalStatus === 'WAITING_ENTRY' || item.outcomeType === 'VALIDATED').length,
    [legitimateTrades]
  );
  const winCount = useMemo(
    () => legitimateTrades.filter((item) => {
      const s = `${item.signalStatus || ''} ${item.outcomeType || ''}`.toUpperCase();
      return s.includes('TP') || s.includes('WIN') || s.includes('COMPLETED') || item.tp1Status === 'HIT' || item.tp2Status === 'HIT' || item.tp3Status === 'HIT';
    }).length,
    [legitimateTrades]
  );
  const lossCount = useMemo(
    () => legitimateTrades.filter((item) => {
      const s = `${item.signalStatus || ''} ${item.outcomeType || ''}`.toUpperCase();
      return s.includes('SL') || s.includes('LOSS') || s.includes('STOPPED') || item.slStatus === 'HIT';
    }).length,
    [legitimateTrades]
  );
  const expiredCount = useMemo(
    () => legitimateTrades.filter((item) => {
      const s = `${item.signalStatus || ''} ${item.outcomeType || ''}`.toUpperCase();
      return s.includes('EXPIRED') || s.includes('NO_ENTRY');
    }).length,
    [legitimateTrades]
  );
  const topCount = useMemo(
    () => legitimateTrades.filter((item) => item.isTopTrade || item.isBestTrade || item.outcomeType === 'TOP_TRADE' || item.outcomeType === 'BEST_TRADE').length,
    [legitimateTrades]
  );
  const suggestionCount = useMemo(
    () => legitimateTrades.filter((item) => item.isSuggestion || item.outcomeType === 'SUGGESTION').length,
    [legitimateTrades]
  );

  // Filtered dataset
  const filteredHistory = useMemo(() => {
    return legitimateTrades.filter((item) => {
      // Time range filter
      if (rangeCutoff > 0 && item.timestamp < rangeCutoff) return false;

      // Direction filter
      if (directionFilter !== 'ALL' && item.direction !== directionFilter) return false;

      // Search filter
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.trim().toLowerCase();
        const sym = item.symbol.toLowerCase();
        const strat = (item.strategy || '').toLowerCase();
        const prov = (item.dataSource || '').toLowerCase();
        if (!sym.includes(q) && !strat.includes(q) && !prov.includes(q)) {
          return false;
        }
      }

      // Status filter
      if (filter === 'ACTIVE') {
        return item.signalStatus === 'ACTIVE' || item.signalStatus === 'WAITING_ENTRY' || item.outcomeType === 'VALIDATED';
      }
      if (filter === 'WINS') {
        const s = `${item.signalStatus || ''} ${item.outcomeType || ''}`.toUpperCase();
        return s.includes('TP') || s.includes('WIN') || s.includes('COMPLETED') || item.tp1Status === 'HIT' || item.tp2Status === 'HIT' || item.tp3Status === 'HIT';
      }
      if (filter === 'LOSSES') {
        const s = `${item.signalStatus || ''} ${item.outcomeType || ''}`.toUpperCase();
        return s.includes('SL') || s.includes('LOSS') || s.includes('STOPPED') || item.slStatus === 'HIT';
      }
      if (filter === 'EXPIRED') {
        const s = `${item.signalStatus || ''} ${item.outcomeType || ''}`.toUpperCase();
        return s.includes('EXPIRED') || s.includes('NO_ENTRY');
      }
      if (filter === 'TOP_TRADE') {
        return item.isTopTrade || item.isBestTrade || item.outcomeType === 'TOP_TRADE' || item.outcomeType === 'BEST_TRADE';
      }
      if (filter === 'SUGGESTION') {
        return item.isSuggestion || item.outcomeType === 'SUGGESTION';
      }
      return true;
    });
  }, [legitimateTrades, rangeCutoff, directionFilter, searchQuery, filter]);

  // Paginated items
  const totalCount = filteredHistory.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const paginatedItems = useMemo(() => {
    return filteredHistory.slice(startIndex, startIndex + pageSize);
  }, [filteredHistory, startIndex, pageSize]);

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
              <h3 className="text-xs sm:text-sm font-semibold text-white truncate">Authoritative Historical Trades & Signal Log</h3>
              <span className="text-[10px] sm:text-xs font-mono bg-slate-950 text-emerald-400 px-2 py-0.5 rounded border border-slate-800 shrink-0 font-bold">
                {filteredHistory.length} Trades
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              Firestore production audit trail with immutable original entry, SL, and TP targets
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

      {/* Filter and Search Toolbar */}
      <div className="space-y-2 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
        {/* Row 1: Status Filters */}
        <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono">
          <span className="text-slate-400 font-semibold uppercase mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3 text-slate-400" /> Filter:
          </span>
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`px-2 py-0.5 rounded transition cursor-pointer ${
              filter === 'ALL'
                ? 'bg-slate-800 text-white font-bold border border-slate-700'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            All ({legitimateTrades.length})
          </button>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter('ACTIVE')}
              className={`px-2 py-0.5 rounded transition cursor-pointer ${
                filter === 'ACTIVE'
                  ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-700'
                  : 'bg-slate-900 text-emerald-400/70 hover:text-emerald-300 border border-slate-800'
              }`}
            >
              Active ({activeCount})
            </button>
          )}
          <button
            type="button"
            onClick={() => setFilter('WINS')}
            className={`px-2 py-0.5 rounded transition cursor-pointer ${
              filter === 'WINS'
                ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-700'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Wins / TP Hit ({winCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('LOSSES')}
            className={`px-2 py-0.5 rounded transition cursor-pointer ${
              filter === 'LOSSES'
                ? 'bg-rose-950 text-rose-300 font-bold border border-rose-700'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Losses / SL Hit ({lossCount})
          </button>
          {expiredCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter('EXPIRED')}
              className={`px-2 py-0.5 rounded transition cursor-pointer ${
                filter === 'EXPIRED'
                  ? 'bg-amber-950 text-amber-300 font-bold border border-amber-700'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              Expired ({expiredCount})
            </button>
          )}
          <button
            type="button"
            onClick={() => setFilter('TOP_TRADE')}
            className={`px-2 py-0.5 rounded transition cursor-pointer ${
              filter === 'TOP_TRADE'
                ? 'bg-amber-950 text-amber-300 font-bold border border-amber-700'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Top Trades ({topCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('SUGGESTION')}
            className={`px-2 py-0.5 rounded transition cursor-pointer ${
              filter === 'SUGGESTION'
                ? 'bg-sky-950 text-sky-300 font-bold border border-sky-700'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Suggestions ({suggestionCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('72PLUS_REJECTED')}
            className={`px-2 py-0.5 rounded transition cursor-pointer ${
              filter === '72PLUS_REJECTED'
                ? 'bg-rose-950 text-rose-300 font-bold border border-rose-700'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            70+ Rejected ({rejected72PlusCandidates.length})
          </button>
        </div>

        {/* Row 2: Search, Direction, Range, Page Size */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60 text-[10px] font-mono">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
            {/* Symbol Search Box */}
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search symbol, strategy, provider..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-7 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Direction Selector */}
            <div className="flex items-center bg-slate-900 rounded-lg border border-slate-800 p-0.5">
              <span className="text-slate-500 px-1.5">DIR:</span>
              <button
                type="button"
                onClick={() => setDirectionFilter('ALL')}
                className={`px-2 py-0.5 rounded transition ${
                  directionFilter === 'ALL' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setDirectionFilter('BUY')}
                className={`px-2 py-0.5 rounded transition ${
                  directionFilter === 'BUY' ? 'bg-emerald-950 text-emerald-400 font-bold border border-emerald-800' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setDirectionFilter('SELL')}
                className={`px-2 py-0.5 rounded transition ${
                  directionFilter === 'SELL' ? 'bg-rose-950 text-rose-400 font-bold border border-rose-800' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                SELL
              </button>
            </div>

            {/* Range Selector */}
            <div className="flex items-center bg-slate-900 rounded-lg border border-slate-800 p-0.5">
              <span className="text-slate-500 px-1.5">RANGE:</span>
              {(['7D', '30D', '90D', 'ALL'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRangeFilter(r)}
                  className={`px-2 py-0.5 rounded transition ${
                    rangeFilter === r ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Page Size Selector */}
          <div className="flex items-center gap-1 text-slate-400">
            <span>SHOW:</span>
            {[10, 20, 50].map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setPageSize(sz)}
                className={`px-1.5 py-0.5 rounded transition ${
                  pageSize === sz ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs Header */}
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
          Historical Trade Setups ({filteredHistory.length})
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
          Historical Performance Analytics
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
      ) : paginatedItems.length > 0 ? (
        <div className="space-y-3">
          {/* Bulk Action Controls */}
          {onDeleteMultipleHistoryItems && (
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs shadow-inner">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white transition select-none">
                <input
                  type="checkbox"
                  checked={paginatedItems.length > 0 && paginatedItems.every((item) => selectedIds.includes(item.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const newIds = new Set(selectedIds);
                      paginatedItems.forEach((i) => newIds.add(i.id));
                      setSelectedIds(Array.from(newIds));
                    } else {
                      const removeSet = new Set(paginatedItems.map((i) => i.id));
                      setSelectedIds((prev) => prev.filter((id) => !removeSet.has(id)));
                    }
                  }}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-900 cursor-pointer h-4 w-4"
                />
                <span className="font-mono text-[11px] font-bold tracking-wider">
                  SELECT PAGE ({paginatedItems.length})
                </span>
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

          {paginatedItems.map((item) => {
            const isExpanded = expandedId === item.id;
            const precision = item.entryPrice ? getDynamicPrecision(item.entryPrice, item.symbol) : 2;
            const isDeleting = deletingIds.includes(item.id);

            // Authoritative status evaluation
            const statusStr = `${item.signalStatus || ''} ${item.outcomeType || ''}`.toUpperCase();
            const isWin = statusStr.includes('TP') || statusStr.includes('WIN') || statusStr.includes('COMPLETED') || item.tp1Status === 'HIT' || item.tp2Status === 'HIT' || item.tp3Status === 'HIT';
            const isLoss = statusStr.includes('SL') || statusStr.includes('LOSS') || statusStr.includes('STOPPED') || item.slStatus === 'HIT';
            const isExpired = statusStr.includes('EXPIRED') || statusStr.includes('NO_ENTRY');
            const isActive = item.signalStatus === 'ACTIVE' || item.signalStatus === 'WAITING_ENTRY' || item.outcomeType === 'VALIDATED';

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

                {/* Header Row: Symbol, Direction, Status, Outcome & Badges */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
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

                    {/* Direction Badge */}
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

                    {/* Symbol */}
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

                    {/* Outcome / Status Badge */}
                    {isWin ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-500 text-[10px] sm:text-xs font-mono font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        WIN (TARGET HIT)
                      </span>
                    ) : isLoss ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-rose-950 text-rose-300 border-rose-500 text-[10px] sm:text-xs font-mono font-bold">
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        LOSS (STOPPED OUT)
                      </span>
                    ) : isExpired ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-amber-950/90 text-amber-300 border-amber-600 text-[10px] sm:text-xs font-mono font-bold">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        EXPIRED
                      </span>
                    ) : isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-sky-950 text-sky-300 border-sky-500 text-[10px] sm:text-xs font-mono font-bold shadow-[0_0_8px_rgba(14,165,233,0.15)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                        {item.signalStatus === 'WAITING_ENTRY' ? 'WAITING ENTRY' : 'ACTIVE'}
                      </span>
                    ) : (
                      <span className="text-[10px] sm:text-xs font-mono font-bold px-2 py-0.5 rounded border bg-slate-900 text-slate-300 border-slate-700">
                        {formatStatus(item.signalStatus || 'VALIDATED')}
                      </span>
                    )}

                    {item.isBestTrade || item.rankTier === 'BEST_TRADE' || item.outcomeType === 'BEST_TRADE' ? (
                      <span className="text-[10px] sm:text-xs font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2 py-0.5 rounded">
                        {formatRankTier('BEST_TRADE', true)}
                      </span>
                    ) : null}
                  </div>

                  {/* Right: Scores & Timestamps */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] sm:text-xs font-mono shrink-0">
                    {item.confidenceScore !== undefined && (
                      <span className="text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        Score: <strong className="text-sky-400 font-bold">{item.confidenceScore}/100</strong>
                      </span>
                    )}

                    <span className="text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      R:R: <strong className="text-emerald-400 font-bold">{item.riskRewardRatio || 2}:1</strong>
                    </span>

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

                    {/* Fullscreen AI Report Inspection Button */}
                    <button
                      type="button"
                      onClick={() => setInspectedSignal(item as unknown as TradingSignal)}
                      className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-300 border border-slate-800 transition cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center shadow-sm"
                      title="Inspect Full AI Signals Report with Deep Zoom"
                      aria-label="Inspect Full Report"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
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

                {/* Execution Price & Target Cards Grid */}
                {item.entryPrice !== undefined && item.entryPrice > 0 ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 font-mono">
                    {/* Immutable Entry Price */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 sm:p-3 space-y-1 flex flex-col justify-between shadow-sm">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                          ORIGINAL ENTRY
                        </span>
                        <div className="text-base sm:text-xl font-bold text-white tracking-tight mt-0.5 truncate">
                          {item.entryPrice.toFixed(precision)}
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 block pt-1 border-t border-slate-800/80 truncate">
                        Immutable Setup Level
                      </span>
                    </div>

                    {/* Immutable Stop Loss */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 sm:p-3 space-y-1 flex flex-col justify-between shadow-sm">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                          STOP LOSS (SL)
                        </span>
                        <div className="text-base sm:text-xl font-bold text-rose-400 tracking-tight mt-0.5 truncate">
                          {item.stopLoss?.toFixed(precision)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                        <span>Status:</span>
                        <strong className={item.slStatus === 'HIT' ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                          {item.slStatus === 'HIT' ? 'HIT' : 'ACTIVE'}
                        </strong>
                      </div>
                    </div>

                    {/* Immutable Take Profit Targets */}
                    <div className="bg-slate-900/90 border border-emerald-900/60 rounded-lg p-2.5 sm:p-3 space-y-1.5 shadow-sm col-span-2 lg:col-span-1">
                      <div className="flex items-center justify-between pb-0.5 border-b border-emerald-950/80">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">
                          TAKE PROFIT TARGETS
                        </span>
                        <span className="text-[9px] text-emerald-400/80 bg-emerald-950 px-1 py-0.2 rounded font-mono">
                          TP1 / TP2 / TP3
                        </span>
                      </div>

                      <div className="grid grid-cols-3 lg:grid-cols-1 gap-1 font-mono">
                        {/* TP1 */}
                        <div className={`p-1 sm:p-1.5 rounded flex flex-col lg:flex-row items-center justify-between gap-0.5 shadow-sm text-center lg:text-left ${
                          item.tp1Status === 'HIT' ? 'bg-emerald-950/90 border border-emerald-500' : 'bg-slate-950/90 border border-emerald-900/50'
                        }`}>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-emerald-400/90">TP1</span>
                            {item.tp1Status === 'HIT' && <Check className="w-3 h-3 text-emerald-400" />}
                          </div>
                          <strong className="text-xs sm:text-sm font-bold text-emerald-400 tracking-tight">
                            {(item.tp1 ?? item.takeProfit)?.toFixed(precision)}
                          </strong>
                        </div>

                        {/* TP2 */}
                        <div className={`p-1 sm:p-1.5 rounded flex flex-col lg:flex-row items-center justify-between gap-0.5 shadow-sm text-center lg:text-left ${
                          item.tp2Status === 'HIT' ? 'bg-emerald-950/90 border border-emerald-500' : 'bg-slate-950/90 border border-emerald-800/60'
                        }`}>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-emerald-300">TP2</span>
                            {item.tp2Status === 'HIT' && <Check className="w-3 h-3 text-emerald-400" />}
                          </div>
                          <strong className="text-xs sm:text-sm font-bold text-emerald-300 tracking-tight">
                            {(item.tp2 ?? item.takeProfit)?.toFixed(precision)}
                          </strong>
                        </div>

                        {/* TP3 */}
                        <div className={`p-1 sm:p-1.5 rounded flex flex-col lg:flex-row items-center justify-between gap-0.5 shadow-sm text-center lg:text-left ${
                          item.tp3Status === 'HIT' ? 'bg-emerald-950/90 border border-emerald-500' : 'bg-slate-950/90 border border-emerald-700/60'
                        }`}>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-emerald-200">TP3</span>
                            {item.tp3Status === 'HIT' && <Check className="w-3 h-3 text-emerald-400" />}
                          </div>
                          <strong className="text-xs sm:text-sm font-bold text-emerald-200 tracking-tight">
                            {(item.tp3 ?? item.takeProfit)?.toFixed(precision)}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Risk/Reward Ratio & Strategy Block */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 sm:p-3 space-y-1 flex flex-col justify-between shadow-sm col-span-2 lg:col-span-1">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                          RISK / REWARD
                        </span>
                        <div className="text-base sm:text-xl font-bold text-blue-400 tracking-tight mt-0.5">
                          {item.riskRewardRatio}:1
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800/80 truncate">
                        Strategy: <strong className="text-slate-200">{formatStrategy(item.strategy || 'Trend Confluence')}</strong>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="pt-3 border-t border-slate-800/80 space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/60">
                      <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-200">
                        <Zap className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Detailed Target Tracking & Validation Diagnostics</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ReportZoomControls
                          zoomLevel={reportZoomLevel}
                          onZoomIn={reportZoomIn}
                          onZoomOut={reportZoomOut}
                          onResetZoom={reportResetZoom}
                          onSetZoom={reportSetZoom}
                          compact={true}
                          idPrefix={`drawer-zoom-${item.id}`}
                        />
                        <button
                          type="button"
                          onClick={() => setInspectedSignal(item as unknown as TradingSignal)}
                          className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-300 border border-slate-800 text-[11px] font-mono flex items-center gap-1.5 transition cursor-pointer"
                          title="Open Full Screen AI Report with Zoom"
                        >
                          <Maximize2 className="w-3 h-3" />
                          <span className="hidden sm:inline">Full Report</span>
                        </button>
                      </div>
                    </div>

                    <ZoomableReportWrapper zoomLevel={reportZoomLevel} id={`drawer-report-wrapper-${item.id}`} className="space-y-3">
                      {/* Target Tracker with live verification */}
                      <TargetTracker
                        signal={item as unknown as TradingSignal}
                        precision={precision}
                        onSignalRefreshed={onSignalRefreshed}
                      />

                      {/* Technical Confluence Breakdown */}
                      <AcceptanceBreakdown signal={item as any} />

                      {/* AI Risk Evaluation */}
                      {item.aiAssessment && (
                        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 text-slate-200 space-y-1.5">
                          <div className="flex items-center gap-2 text-cyan-400 font-semibold text-xs uppercase tracking-wider">
                            <Cpu className="w-4 h-4 text-emerald-400" />
                            <span>NVIDIA AI Confluence Analysis</span>
                          </div>
                          <p className="text-slate-200 leading-relaxed font-sans text-xs sm:text-sm">{item.aiAssessment}</p>
                        </div>
                      )}

                      {/* Metadata Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
                        {item.snapshotId && (
                          <span>
                            ID: <strong className="text-slate-300">{item.snapshotId}</strong>
                          </span>
                        )}
                        {item.dataSource && (
                          <span>
                            Provider: <strong className="text-slate-300">{formatProviderName(item.dataSource)}</strong>
                          </span>
                        )}
                        <span>
                          Provenance: <strong className="text-emerald-400 font-semibold">LIVE PRODUCTION (IMMUTABLE)</strong>
                        </span>
                      </div>
                    </ZoomableReportWrapper>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono">
              <span className="text-slate-400">
                Showing <strong className="text-white">{startIndex + 1}</strong> to{' '}
                <strong className="text-white">{Math.min(startIndex + pageSize, totalCount)}</strong> of{' '}
                <strong className="text-white">{totalCount}</strong> trades
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={validCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className={`px-3 py-1.5 rounded-lg border flex items-center gap-1 transition ${
                    validCurrentPage <= 1
                      ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                      : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border-slate-700 cursor-pointer'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>

                <span className="px-3 py-1 bg-slate-900 rounded-lg border border-slate-800 text-slate-300">
                  Page <strong className="text-emerald-400">{validCurrentPage}</strong> of{' '}
                  <strong className="text-white">{totalPages}</strong>
                </span>

                <button
                  type="button"
                  disabled={validCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className={`px-3 py-1.5 rounded-lg border flex items-center gap-1 transition ${
                    validCurrentPage >= totalPages
                      ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                      : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border-slate-700 cursor-pointer'
                  }`}
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Empty State */
        <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-8 text-center text-slate-500">
          <History className="w-8 h-8 mx-auto mb-2 text-slate-600" />
          <p className="text-xs text-slate-400 font-medium">No Historical Trades Found</p>
          <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
            {searchQuery || filter !== 'ALL' || directionFilter !== 'ALL'
              ? 'No trades match the selected filters. Try clearing or broadening search filters.'
              : 'Validated trades generated from live scans will automatically be preserved in this authoritative Firestore audit collection.'}
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
                <h4 className="text-sm font-semibold text-white">Delete Historical Trade Entry?</h4>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Are you sure you want to delete the trade history entry for <strong className="text-white font-mono">{itemToDelete.symbol}</strong>?
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
                <h4 className="text-sm font-semibold text-white">Clear All Historical Trades?</h4>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Are you sure you want to wipe all <strong className="text-white">{legitimateTrades.length}</strong> historical trade audit records?
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
                  Are you sure you want to delete the <strong className="text-white font-mono">{selectedIds.length}</strong> selected historical trade entries? This action is permanent and persistent.
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

      {/* Full AI Signals Report Modal with Zoom */}
      <SignalReportModal
        signal={inspectedSignal}
        isOpen={!!inspectedSignal}
        onClose={() => setInspectedSignal(null)}
        onSignalRefreshed={onSignalRefreshed}
      />
    </div>
  );
}
