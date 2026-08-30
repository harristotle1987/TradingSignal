/**
 * SIGNALS Page Component (Gate 3 - Validated Signal Engine)
 * Real-time Forex & Crypto Signal Generation with Twelve Data / Bitget Integration
 *
 * NO fake, hardcoded, or synthetic signals.
 * "No valid setup = no signal".
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import { HealthResponse, TradingSignal, NormalizedTicker, SignalGenerationResponse, SignalHistoryItem } from '../types/index.js';
import { StatusBadge } from './StatusBadge.js';
import { formatTimeWithZone, DisplayTimeZone, getLocalTimeZone } from '../utils/time.js';
import { NotificationService, NotificationPermissionStatus } from '../utils/notification.js';
import { SignalHistoryPanel } from './SignalHistoryPanel.js';
import { AssetClassScanner } from './AssetClassScanner.js';
import { AiMarketScannerWidget } from './AiMarketScannerWidget.js';
import {
  formatLabel,
  formatStrategy,
  formatStatus,
  formatRankTier,
  formatProviderName,
} from '../utils/formatters.js';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  Activity,
  Zap,
  Clock,
  Database,
  Cpu,
  Layers,
  CheckCircle2,
  Trash2,
  Check,
  Globe,
  Bell,
  BellRing,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface SignalsPageProps {
  health: HealthResponse | null;
}

export function SignalsPage({ health }: SignalsPageProps) {
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');
  const [activeSignals, setActiveSignals] = useState<TradingSignal[]>([]);
  const [ticker, setTicker] = useState<NormalizedTicker | null>(null);
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastGenResult, setLastGenResult] = useState<SignalGenerationResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preferredTimeZone, setPreferredTimeZone] = useState<DisplayTimeZone>('LOCAL');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionStatus>(
    NotificationService.getPermission()
  );
  const [soundAlerts, setSoundAlerts] = useState<boolean>(true);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [rejected72PlusCandidates, setRejected72PlusCandidates] = useState<any[]>([]);
  const isInitialLoad = useRef<boolean>(true);

  // Local State-Based Signal History (Last 30 generated signals/outcomes)
  const HISTORY_STORAGE_KEY = 'trading_signal_history_v1';
  const [signalHistory, setSignalHistory] = useState<SignalHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // GATE 62: filter out entries that do not explicitly contain isTradeableSignal === true && signalClassification === 'TRADEABLE'
          return parsed
            .filter((item: any) => item && item.isTradeableSignal === true && item.signalClassification === 'TRADEABLE')
            .slice(0, 30);
        }
      }
    } catch (e) {
      console.warn('Failed to load signal history from storage:', e);
    }
    return [];
  });

  // Save history to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(signalHistory));
    } catch (e) {
      console.warn('Failed to persist signal history:', e);
    }
  }, [signalHistory]);

  // Helper to add signals to local history (Max 30, newest first)
  const addSignalsToHistory = useCallback(
    (signals: TradingSignal[], defaultOutcome?: SignalHistoryItem['outcomeType']) => {
      if (!signals || signals.length === 0) return;

      setSignalHistory((prev) => {
        const existingIds = new Set(prev.map((h) => h.id));
        const newItems: SignalHistoryItem[] = [];

        for (const sig of signals) {
          // GATE 62: Reject any signal unless isTradeableSignal === true AND signalClassification === 'TRADEABLE'
          // Do this BEFORE creating the SignalHistoryItem.
          // Do not infer tradeability from score, isTopTrade, isBestTrade, rankTier, status, outcomeType.
          if (sig.isTradeableSignal !== true || sig.signalClassification !== 'TRADEABLE') {
            continue;
          }

          const uniqueId = sig.id || sig.snapshotId || `${sig.symbol}_${sig.timestamp}`;
          if (!existingIds.has(uniqueId)) {
            existingIds.add(uniqueId);
            newItems.push({
              id: uniqueId,
              snapshotId: sig.snapshotId,
              symbol: sig.symbol,
              direction: sig.direction,
              entryPrice: sig.entryPrice,
              stopLoss: sig.stopLoss,
              takeProfit: sig.takeProfit,
              tp1: sig.tp1,
              tp2: sig.tp2,
              tp3: sig.tp3,
              riskRewardRatio: sig.riskRewardRatio,
              score: sig.score,
              confidenceScore: sig.confidenceScore,
              isTopTrade: sig.isTopTrade,
              isBestTrade: sig.isBestTrade,
              isSecondBest: sig.isSecondBest,
              isSuggestion: sig.isSuggestion,
              rankTier: sig.rankTier,
              outcomeType: sig.isBestTrade || sig.rankTier === 'BEST_TRADE'
                ? 'BEST_TRADE'
                : sig.isSecondBest || sig.rankTier === 'SECOND_BEST'
                ? 'SECOND_BEST'
                : sig.isSuggestion || sig.rankTier === 'SUGGESTION'
                ? 'SUGGESTION'
                : sig.isTopTrade
                ? 'TOP_TRADE'
                : defaultOutcome || 'VALIDATED',
              strategy: sig.strategy,
              timeframe: sig.timeframe,
              dataSource: sig.dataSource,
              reason: sig.aiAssessment || (sig.confluenceReasons && sig.confluenceReasons.join('; ')),
              timestamp: sig.validatedAt || sig.timestamp || Date.now(),
              confluenceReasons: sig.confluenceReasons,
              aiAssessment: sig.aiAssessment,
              estimatedWinRate: sig.estimatedWinRate,
              isAiValidated: sig.isAiValidated,
              stopDistance: sig.stopDistance,
              pipPointUnit: sig.pipPointUnit,
              estimatedFriction: sig.estimatedFriction,
              signalStatus: sig.status,
              tp1Status: sig.tp1Status,
              tp2Status: sig.tp2Status,
              tp3Status: sig.tp3Status,
              slStatus: sig.slStatus,
              tp1HitAt: sig.tp1HitAt,
              tp2HitAt: sig.tp2HitAt,
              tp3HitAt: sig.tp3HitAt,
              stopLossHitAt: sig.stopLossHitAt,
              tp1HitPrice: sig.tp1HitPrice,
              tp2HitPrice: sig.tp2HitPrice,
              tp3HitPrice: sig.tp3HitPrice,
              stopLossHitPrice: sig.stopLossHitPrice,
              isTradeableSignal: true,
              signalClassification: 'TRADEABLE',
            });
          }
        }

        if (newItems.length === 0) return prev;
        return [...newItems, ...prev].slice(0, 30);
      });
    },
    []
  );

  // Load dedicated signal logs from backend
  const loadDedicatedSignalLogs = useCallback(async () => {
    try {
      const res = await api.getSignalLogs();
      if (res && res.success && Array.isArray(res.logs) && res.logs.length > 0) {
        // DEFENSE-IN-DEPTH: strictly filter tradeable signals on the frontend
        const tradeableLogs = res.logs.filter((log: any) => log && log.isTradeableSignal === true && log.signalClassification === 'TRADEABLE');

        const mappedItems: SignalHistoryItem[] = tradeableLogs.map((log: any) => ({
          id: log.id,
          snapshotId: log.snapshotId || log.id,
          symbol: log.symbol,
          direction: log.direction,
          entryPrice: log.entryPrice,
          stopLoss: log.stopLoss,
          takeProfit: log.takeProfit,
          tp1: log.tp1,
          tp2: log.tp2,
          tp3: log.tp3,
          riskRewardRatio: log.riskRewardRatio,
          score: log.score,
          confidenceScore: log.confidenceScore,
          estimatedWinRate: log.estimatedWinRate ?? log.modelEstimatedWinRate,
          modelEstimatedWinRate: log.modelEstimatedWinRate,
          empiricalProbability: log.empiricalProbability,
          probabilitySampleSize: log.probabilitySampleSize,
          isEmpiricallyCalibrated: log.isEmpiricallyCalibrated,
          probabilityConfidenceInterval: log.probabilityConfidenceInterval,
          isTopTrade: log.isTopTrade || log.isBestTrade,
          isBestTrade: log.isBestTrade,
          outcomeType: log.isBestTrade
            ? 'BEST_TRADE'
            : (log.status === 'ACTIVE' || log.status === 'WAITING_ENTRY')
            ? 'VALIDATED'
            : 'TOP_TRADE',
          strategy: formatStrategy(log.strategy),
          timeframe: log.timeframe || '1h',
          dataSource: formatLabel(log.provider || log.dataSource),
          reason: `Market Type: ${formatLabel(log.marketType || 'Asset')} | Provider: ${formatProviderName(log.provider || 'Live Feed')} | Regime: ${formatLabel(log.marketRegime || 'TREND')} | Status: ${formatStatus(log.status || 'WAITING_ENTRY')} | Score: ${log.score}/100`,
          timestamp: log.timestamp || Date.now(),
          marketType: log.marketType,
          marketRegime: log.marketRegime,
          signalStatus: log.status,
          tp1Status: log.tp1Status,
          tp2Status: log.tp2Status,
          tp3Status: log.tp3Status,
          slStatus: log.slStatus,
          tp1HitAt: log.tp1HitAt,
          tp2HitAt: log.tp2HitAt,
          tp3HitAt: log.tp3HitAt,
          stopLossHitAt: log.stopLossHitAt,
          tp1HitPrice: log.tp1HitPrice,
          tp2HitPrice: log.tp2HitPrice,
          tp3HitPrice: log.tp3HitPrice,
          stopLossHitPrice: log.stopLossHitPrice,
          confluenceReasons: log.confluenceReasons,
          aiAssessment: log.aiAssessment,
          isTradeableSignal: true,
          signalClassification: 'TRADEABLE',
        }));
        setSignalHistory(mappedItems.slice(0, 30));
      }
    } catch (err) {
      console.warn('Could not load dedicated signal logs from backend:', err);
    }
  }, []);

  useEffect(() => {
    loadDedicatedSignalLogs();
  }, [loadDedicatedSignalLogs]);

  // Clear history handler
  const handleClearHistory = async () => {
    setSignalHistory([]);
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      await api.clearSignalLogs();
    } catch (e) {
      console.warn('Failed to wipe signal history:', e);
    }
  };

  // Individual history item deletion handler
  const handleDeleteHistoryItem = async (id: string, symbol: string) => {
    setDeletingIds((prev) => [...prev, id]);
    try {
      await api.deleteSignalLog(id);
      setSignalHistory((prev) => {
        const updated = prev.filter((item) => item.id !== id && item.snapshotId !== id);
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.warn('Failed to update localStorage signal history:', e);
        }
        return updated;
      });
    } catch (e) {
      console.warn(`Failed to delete backend signal log entry ${id}:`, e);
      throw e;
    } finally {
      setDeletingIds((prev) => prev.filter((dId) => dId !== id));
    }
  };

  // Bulk history item deletion handler
  const handleDeleteMultipleHistoryItems = async (ids: string[]) => {
    setDeletingIds((prev) => [...prev, ...ids]);
    try {
      await api.deleteSignalLogs(ids);
      setSignalHistory((prev) => {
        const updated = prev.filter((item) => !ids.includes(item.id) && !ids.includes(item.snapshotId));
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.warn('Failed to update localStorage signal history:', e);
        }
        return updated;
      });
    } catch (e) {
      console.error('Failed to bulk delete signal logs:', e);
      throw e;
    } finally {
      setDeletingIds((prev) => prev.filter((dId) => !ids.includes(dId)));
    }
  };

  // Strict Market Session Manager Frontend State
  const [sessionDetails, setSessionDetails] = useState<{
    symbol: string;
    assetClassification: string;
    sessionState: 'MARKET_OPEN' | 'MARKET_CLOSED' | 'OUTSIDE_TRADING_SESSION';
    timestamp: number;
    formattedUTC: string;
    newYorkTime: {
      weekday: string;
      hour: number;
      minute: number;
      second?: number;
      dateString: string;
      timeZoneAbbr?: string;
      formatted: string;
    };
    utcTime?: {
      weekday: string;
      hour: number;
      minute: number;
      second?: number;
      dateString: string;
      formatted: string;
    };
    londonTime?: {
      weekday: string;
      hour: number;
      minute: number;
      formatted: string;
    };
    tokyoTime?: {
      weekday: string;
      hour: number;
      minute: number;
      formatted: string;
    };
  } | null>(null);

  const isNvidiaConfigured = health?.aiProvider?.configured ?? false;

  // User-triggered price fetch with debounce / concurrency lock
  const fetchForexMarketPrice = useCallback(async (sym?: string) => {
    if (isFetchingPrice) return;
    const targetSymbol = (sym || selectedSymbol).trim().toUpperCase();

    setIsFetchingPrice(true);
    setErrorMsg(null);
    try {
      const data = await api.fetchMarketPrice(targetSymbol, undefined, 'USER_CLICK');
      if (data && data.price > 0) {
        setTicker(data);
        setErrorMsg(null);
      } else if (data && data.status === 'MARKET_DATA_UNAVAILABLE') {
        setErrorMsg(data.errorMessage || `Market price currently unavailable for ${targetSymbol}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SignalsPage] Failed to fetch price for ${targetSymbol}:`, msg);
      setErrorMsg(`Failed to fetch price for ${targetSymbol}: ${msg}`);
    } finally {
      setIsFetchingPrice(false);
    }
  }, [selectedSymbol, isFetchingPrice]);

  // Load strict session details (Timezone calculations only - zero external price fetches)
  const loadSessionDetails = useCallback(async (sym: string) => {
    try {
      const data = await api.getSessionDetails(sym);
      if (data && data.sessionState && data.newYorkTime && typeof data.newYorkTime === 'object') {
        setSessionDetails(data);
      }
    } catch (err) {
      console.warn(`[SignalsPage] Polling session details for ${sym} paused:`, err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Check and fire native browser notifications for any new TOP TRADEs
  const checkTopTradeNotifications = useCallback((signals: TradingSignal[]) => {
    // Avoid re-alerting historical signals on the very first page mount
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }

    signals.forEach((sig) => {
      if (sig.isTopTrade || sig.strategy?.includes('[TOP TRADE]')) {
        NotificationService.notifyTopTrade(sig, soundAlerts);
      }
    });
  }, [soundAlerts]);

  // Load active signals list
  const loadActiveSignals = useCallback(async () => {
    try {
      const res = await api.getSignals();
      if (res && res.success && Array.isArray(res.signals)) {
        // GATE 79: Strictly filter out any active signals that are not tradeable
        const filteredSignals = res.signals.filter((sig: any) =>
          sig && sig.isTradeableSignal === true && sig.signalClassification === 'TRADEABLE'
        );
        setActiveSignals(filteredSignals);
        checkTopTradeNotifications(filteredSignals);
        if (filteredSignals.length > 0) {
          addSignalsToHistory(filteredSignals);
        }
      }
    } catch (err) {
      console.warn('[SignalsPage] Polling active signals paused:', err instanceof Error ? err.message : String(err));
    }
  }, [checkTopTradeNotifications, addSignalsToHistory]);

  useEffect(() => {
    // Zero automated price requests on load, mount, navigation, focus or timers
    loadSessionDetails(selectedSymbol);
    loadActiveSignals();

    // Periodic check for session state and active signals only (Zero price requests)
    const interval = setInterval(() => {
      loadSessionDetails(selectedSymbol);
      loadActiveSignals();
    }, 15000);

    return () => clearInterval(interval);
  }, [selectedSymbol, loadSessionDetails, loadActiveSignals]);

  // Handle Request Notification Permission
  const handleRequestNotificationPermission = async () => {
    const perm = await NotificationService.requestPermission();
    setNotificationPermission(perm);
    if (perm === 'granted') {
      NotificationService.sendTestAlert();
    }
  };

  // Handle Test Alert
  const handleSendTestNotification = () => {
    NotificationService.sendTestAlert();
  };

  // Handle Signal Generation Trigger
  const handleGenerateSignal = useCallback(async () => {
    setIsGenerating(true);
    setLastGenResult(null);
    setErrorMsg(null);

    try {
      const result = await api.generateSignal(selectedSymbol);
      setLastGenResult(result);
      if (result.candidateRejectionDetails) {
        const list72 = result.candidateRejectionDetails.filter(
          (c: any) => c.is72PlusRejected || (c.score >= 70 || c.finalScore >= 70)
        );
        if (list72.length > 0) {
          setRejected72PlusCandidates((prev) => {
            const map = new Map();
            for (const item of [...list72, ...prev]) {
              if (!map.has(item.symbol)) map.set(item.symbol, item);
            }
            return Array.from(map.values());
          });
        }
      }
      if (result.marketPrice && ticker) {
        setTicker((prev) => (prev ? { ...prev, price: result.marketPrice! } : prev));
      }

      // If the newly generated signal is valid, record into history and trigger alert
      if (result.signal) {
        addSignalsToHistory([result.signal]);

        if (result.signal.symbol && result.signal.symbol !== selectedSymbol) {
          setSelectedSymbol(result.signal.symbol);
        }

        if (result.signal.isTopTrade || result.signal.strategy?.includes('[TOP TRADE]')) {
          NotificationService.notifyTopTrade(result.signal, soundAlerts);
        }
      } else if (result.signals && result.signals.length > 0) {
        addSignalsToHistory(result.signals);
      }

      await loadActiveSignals();
      await loadDedicatedSignalLogs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Signal generation error: ${msg}`);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedSymbol, ticker, soundAlerts, loadActiveSignals, addSignalsToHistory]);

  // Handle Clear Signals
  const handleClearSignals = async () => {
    try {
      await api.clearSignals();
      setActiveSignals([]);
      setLastGenResult(null);
    } catch (err) {
      console.error('Failed to clear signals:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Policy & Gate Status Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm text-slate-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-slate-800 rounded-lg text-emerald-400 border border-slate-700">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                Gate 3.1 Market Session Manager
                <span className="text-[10px] font-mono font-normal bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">
                  SESSION CONTROL ACTIVE
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Guarantees Forex & Stock signals are strictly generated within their official exchange calendars. Crypto assets remain fully operational 24/7.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-signals-refresh"
              onClick={() => {
                if (isFetchingPrice) return;
                fetchForexMarketPrice(selectedSymbol);
                loadSessionDetails(selectedSymbol);
                loadActiveSignals();
              }}
              disabled={isFetchingPrice}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetchingPrice ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            {activeSignals.length > 0 && (
              <button
                id="btn-signals-clear"
                onClick={handleClearSignals}
                className="px-3 py-1.5 bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 text-xs font-medium rounded-lg border border-slate-700 hover:border-rose-800/50 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Dedicated Asset Class Signal Scanner (CRYPTO | FOREX | STOCKS) */}
      <AssetClassScanner
        selectedSymbol={selectedSymbol}
        onSelectSymbol={(sym) => {
          setSelectedSymbol(sym);
          setErrorMsg(null);
        }}
        onScan={handleGenerateSignal}
        onFetchPrice={fetchForexMarketPrice}
        isScanning={isGenerating}
        scanResult={lastGenResult}
        ticker={ticker}
        isFetchingPrice={isFetchingPrice}
        sessionState={sessionDetails?.sessionState}
        preferredTimeZone={preferredTimeZone}
      />

      {errorMsg && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Generation Result Banner */}
      {lastGenResult && (
        <div
          className={`p-4 rounded-xl border text-xs leading-relaxed ${
            lastGenResult.success
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-slate-900 border-amber-800/50 text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {lastGenResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            )}
            <div>
              <span className="font-semibold">{lastGenResult.message}</span>
              {lastGenResult.reason && (
                <p className="mt-1 text-slate-300 text-[11px] font-mono">
                  Analysis Detail: {lastGenResult.reason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Trade Alert Notification Control Bar */}
      {/* Top Trade Notification Control Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center border shrink-0 mt-0.5 ${
              notificationPermission === 'granted'
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
                : notificationPermission === 'denied'
                ? 'bg-rose-950/60 border-rose-800 text-rose-400'
                : 'bg-amber-950/60 border-amber-800 text-amber-400'
            }`}
          >
            {notificationPermission === 'granted' ? (
              <BellRing className="w-4 h-4 animate-pulse" />
            ) : (
              <Bell className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 xs:gap-2">
              <span className="text-xs font-semibold text-white">
                TOP TRADE Browser Alerts
              </span>
              {notificationPermission === 'granted' ? (
                <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded border border-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5" /> LIVE
                </span>
              ) : notificationPermission === 'denied' ? (
                <span className="text-[10px] font-mono bg-rose-950 text-rose-400 px-2 py-0.5 rounded border border-rose-800">
                  BLOCKED
                </span>
              ) : (
                <span className="text-[10px] font-mono bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800">
                  STANDBY
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-normal">
              Instant alerts & sound chimes trigger when AI validates a new Gate 9 TOP TRADE.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto shrink-0 pt-1 md:pt-0">
          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => setSoundAlerts((prev) => !prev)}
            className={`p-2 rounded-lg border text-xs transition-colors flex items-center gap-1.5 min-h-[38px] cursor-pointer ${
              soundAlerts
                ? 'bg-slate-950 border-slate-800 text-emerald-400 hover:border-slate-700'
                : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-400'
            }`}
            title={soundAlerts ? 'Audio alert chime enabled' : 'Audio alert chime muted'}
          >
            {soundAlerts ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span className="text-[10px] font-mono">{soundAlerts ? 'SOUND ON' : 'MUTED'}</span>
          </button>

          {/* Test Alert Button */}
          <button
            type="button"
            onClick={handleSendTestNotification}
            className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-mono transition-colors min-h-[38px] cursor-pointer"
          >
            Test Alert
          </button>

          {/* Request Permission Button (if not yet granted) */}
          {notificationPermission !== 'granted' && (
            <button
              type="button"
              onClick={handleRequestNotificationPermission}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors shadow-sm min-h-[38px] cursor-pointer"
            >
              Enable Alerts
            </button>
          )}
        </div>
      </div>

      {/* Consolidated Signal History & Alert Log (30-item Audit Hub) */}
      <SignalHistoryPanel
        history={signalHistory}
        rejected72PlusCandidates={rejected72PlusCandidates}
        onClearHistory={handleClearHistory}
        onDeleteHistoryItem={handleDeleteHistoryItem}
        onDeleteMultipleHistoryItems={handleDeleteMultipleHistoryItems}
        deletingIds={deletingIds}
        preferredTimeZone={preferredTimeZone}
        onTimeZoneChange={setPreferredTimeZone}
        onSelectSymbol={(sym) => {
          setSelectedSymbol(sym);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onSignalRefreshed={(updated) => {
          setSignalHistory((prev) =>
            prev.map((item) => {
              if (item.id === updated.id || item.snapshotId === updated.snapshotId) {
                return {
                  ...item,
                  signalStatus: updated.status as any,
                  tp1Status: updated.tp1Status,
                  tp2Status: updated.tp2Status,
                  tp3Status: updated.tp3Status,
                  slStatus: updated.slStatus,
                  tp1HitAt: updated.tp1HitAt,
                  tp2HitAt: updated.tp2HitAt,
                  tp3HitAt: updated.tp3HitAt,
                  stopLossHitAt: updated.stopLossHitAt,
                  tp1HitPrice: updated.tp1HitPrice,
                  tp2HitPrice: updated.tp2HitPrice,
                  tp3HitPrice: updated.tp3HitPrice,
                  stopLossHitPrice: updated.stopLossHitPrice,
                  tp1: updated.tp1,
                  tp2: updated.tp2,
                  tp3: updated.tp3,
                };
              }
              return item;
            })
          );
        }}
      />

      {/* Signal Bot Identity & Risk Management Disclaimer */}
      <div className="bg-slate-950/80 border border-amber-900/40 rounded-xl p-4 sm:p-5 text-slate-400 text-xs leading-relaxed space-y-2">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs tracking-wide uppercase">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Signal Bot Analytical Decision-Support Notice</span>
        </div>
        <p className="text-slate-400 text-[11px]">
          This system functions strictly as an analytical <strong className="text-slate-200">SIGNAL BOT</strong> and technical decision-support tool. It does not execute trades, manage funds, or connect to brokerage accounts. Suggested position sizes and risk figures are purely mathematical illustrations based on configurable hypothetical balances.
        </p>
        <p className="text-slate-500 text-[10px]">
          No representation is made that any signal will achieve guaranteed profits or avoid losses. All financial trading carries substantial risk of capital loss. Minimum qualification filters (win-rate estimate &gt; 30%, R:R &ge; 2:1, ATR noise protection hurdles) are algorithmic safeguards designed to reject weak or noise-vulnerable market setups.
        </p>
      </div>

      {/* GATE 1: Floating AI Market Scanner Widget */}
      <AiMarketScannerWidget
        selectedSymbol={selectedSymbol}
        onSelectSymbol={(sym) => {
          setSelectedSymbol(sym);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onSignalsUpdated={async () => {
          await loadActiveSignals();
          await loadDedicatedSignalLogs();
        }}
      />
    </div>
  );
}
