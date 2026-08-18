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
  const isInitialLoad = useRef<boolean>(true);

  // Local State-Based Signal History (Last 10 generated signals/outcomes)
  const HISTORY_STORAGE_KEY = 'trading_signal_history_v1';
  const [signalHistory, setSignalHistory] = useState<SignalHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.slice(0, 10);
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

  // Helper to add signals to local history (Max 10, newest first)
  const addSignalsToHistory = useCallback(
    (signals: TradingSignal[], defaultOutcome?: SignalHistoryItem['outcomeType']) => {
      if (!signals || signals.length === 0) return;

      setSignalHistory((prev) => {
        const existingIds = new Set(prev.map((h) => h.id));
        const newItems: SignalHistoryItem[] = [];

        for (const sig of signals) {
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
            });
          }
        }

        if (newItems.length === 0) return prev;
        return [...newItems, ...prev].slice(0, 10);
      });
    },
    []
  );

  // Load dedicated signal logs from backend
  const loadDedicatedSignalLogs = useCallback(async () => {
    try {
      const res = await api.getSignalLogs();
      if (res && res.success && Array.isArray(res.logs) && res.logs.length > 0) {
        const mappedItems: SignalHistoryItem[] = res.logs.map((log: any) => ({
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
          isTopTrade: log.isTopTrade || log.isBestTrade,
          isBestTrade: log.isBestTrade,
          outcomeType: log.isBestTrade
            ? 'BEST_TRADE'
            : log.status === 'ACTIVE'
            ? 'VALIDATED'
            : 'TOP_TRADE',
          strategy: log.strategy,
          timeframe: log.timeframe || '1h',
          dataSource: log.provider || log.dataSource,
          reason: `Market Type: ${log.marketType || 'Asset'} | Provider: ${log.provider || 'Live Feed'} | Regime: ${log.marketRegime || 'TREND'} | Status: ${log.status || 'ACTIVE'} | Score: ${log.score}/100`,
          timestamp: log.timestamp || Date.now(),
          marketType: log.marketType,
          marketRegime: log.marketRegime,
          signalStatus: log.status,
        }));
        setSignalHistory(mappedItems.slice(0, 15));
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
    setSignalHistory((prev) => {
      const updated = prev.filter((item) => item.id !== id && item.snapshotId !== id);
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to update localStorage signal history:', e);
      }
      return updated;
    });

    try {
      await api.deleteSignalLog(id);
    } catch (e) {
      console.warn(`Failed to delete backend signal log entry ${id}:`, e);
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

  const isNvidiaConfigured = health?.aiProvider.configured ?? false;

  // Load ticker for selected symbol
  const loadTicker = useCallback(async (sym: string) => {
    setIsFetchingPrice(true);
    try {
      const data = await api.fetchMarketPrice(sym);
      if (data && data.price > 0) {
        setTicker(data);
        setErrorMsg(null);
      }
    } catch (err: unknown) {
      console.warn(`[SignalsPage] Polling ticker for ${sym} paused:`, err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingPrice(false);
    }
  }, []);

  // Load strict session details
  const loadSessionDetails = useCallback(async (sym: string) => {
    try {
      const data = await api.getSessionDetails(sym);
      if (data) {
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
        setActiveSignals(res.signals);
        checkTopTradeNotifications(res.signals);
        if (res.signals.length > 0) {
          addSignalsToHistory(res.signals);
        }
      }
    } catch (err) {
      console.warn('[SignalsPage] Polling active signals paused:', err instanceof Error ? err.message : String(err));
    }
  }, [checkTopTradeNotifications, addSignalsToHistory]);

  useEffect(() => {
    loadTicker(selectedSymbol);
    loadSessionDetails(selectedSymbol);
    loadActiveSignals();

    // Auto-refresh market price, session state and signals every 15s
    const interval = setInterval(() => {
      loadTicker(selectedSymbol);
      loadSessionDetails(selectedSymbol);
      loadActiveSignals();
    }, 15000);

    return () => clearInterval(interval);
  }, [selectedSymbol, loadTicker, loadSessionDetails, loadActiveSignals]);

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
      } else {
        // Record scan evaluation outcome in history
        setSignalHistory((prev) => {
          const scanItem: SignalHistoryItem = {
            id: `scan_${Date.now()}_${result.symbol || selectedSymbol}`,
            snapshotId: `scan_${Date.now()}`,
            symbol: result.symbol || selectedSymbol,
            direction: 'NO_TRADE',
            outcomeType: 'NO_TRADE_OPPORTUNITY',
            reason: result.reason || result.message || 'No setups satisfied strict Gate 7–9 hurdles.',
            timestamp: result.timestamp || Date.now(),
            timeframe: 'Multi-TF Scan',
            dataSource: 'Live Universe Scan',
          };
          return [scanItem, ...prev.filter((p) => p.id !== scanItem.id)].slice(0, 10);
        });
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
              onClick={() => {
                loadTicker(selectedSymbol);
                loadSessionDetails(selectedSymbol);
                loadActiveSignals();
              }}
              disabled={isFetchingPrice}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetchingPrice ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            {activeSignals.length > 0 && (
              <button
                onClick={handleClearSignals}
                className="px-3 py-1.5 bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 text-xs font-medium rounded-lg border border-slate-700 hover:border-rose-800/50 transition flex items-center gap-1.5"
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
        isScanning={isGenerating}
        scanResult={lastGenResult}
        ticker={ticker}
        isFetchingPrice={isFetchingPrice}
        sessionState={sessionDetails?.sessionState}
        preferredTimeZone={preferredTimeZone}
      />

      {/* Live Market Feeds & Exchange Session Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <span className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            Active Feed Diagnostics & Exchange Session Status
          </span>
          {sessionDetails && (
            <StatusBadge
              status={
                sessionDetails.sessionState === 'MARKET_OPEN'
                  ? 'configured'
                  : sessionDetails.sessionState === 'OUTSIDE_TRADING_SESSION'
                  ? 'standby'
                  : 'unconfigured'
              }
              label={
                sessionDetails.sessionState === 'MARKET_OPEN'
                  ? 'MARKET OPEN'
                  : sessionDetails.sessionState === 'OUTSIDE_TRADING_SESSION'
                  ? 'OUTSIDE TRADING SESSION'
                  : 'MARKET CLOSED'
              }
            />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Live Ticker Price */}
          {ticker ? (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400 uppercase">{ticker.rawSymbol || ticker.symbol}</span>
                  <span className="text-[9px] font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 text-slate-400">
                    Active Feed
                  </span>
                </div>
                <div className="text-2xl font-mono font-bold text-white tracking-tight mt-1">
                  {ticker.price ? ticker.price.toFixed(ticker.price < 10 ? 5 : 2) : '0.00'}
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-800/50 flex justify-between text-[11px] font-mono">
                <div>
                  <span className="text-slate-400 block text-[9px]">SOURCE</span>
                  <span className="text-emerald-400 font-semibold uppercase">{ticker.source}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 block text-[9px]">PROVIDER</span>
                  <span className="text-slate-300 font-semibold">
                    {ticker.provider === 'twelvedata'
                      ? 'Twelve Data'
                      : ticker.provider === 'finnhub'
                      ? 'Finnhub'
                      : ticker.provider.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-center text-slate-500 text-xs flex items-center justify-center">
              Fetching live market price...
            </div>
          )}

          {/* Exchange Clock details */}
          {sessionDetails ? (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400 uppercase flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    Exchange Clock (ET)
                  </span>
                  <span className="text-[9px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 px-1.5 py-0.5 rounded">
                    {sessionDetails.newYorkTime.timeZoneAbbr || 'EDT'}
                  </span>
                </div>
                <div className="text-sm font-mono font-bold text-white tracking-tight mt-1.5">
                  {sessionDetails.newYorkTime.formatted}
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-1 flex items-center gap-2">
                  <span title="Universal Coordinated Time">UTC: {sessionDetails.utcTime?.formatted || sessionDetails.formattedUTC}</span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-800/50 flex justify-between text-[11px] font-mono">
                <div>
                  <span className="text-slate-400 block text-[9px]">CLASSIFICATION</span>
                  <span className="text-slate-200 uppercase">{sessionDetails.assetClassification}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 block text-[9px]">CALENDAR STATUS</span>
                  <span
                    className={`font-semibold ${
                      sessionDetails.sessionState === 'MARKET_OPEN'
                        ? 'text-emerald-400'
                        : sessionDetails.sessionState === 'OUTSIDE_TRADING_SESSION'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {sessionDetails.sessionState}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-center text-slate-500 text-xs flex items-center justify-center">
              Resolving exchange calendar...
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

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
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
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
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white">
                TOP TRADE Browser Alerts
              </span>
              {notificationPermission === 'granted' ? (
                <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded border border-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5" /> LIVE
                </span>
              ) : notificationPermission === 'denied' ? (
                <span className="text-[10px] font-mono bg-rose-950 text-rose-400 px-2 py-0.5 rounded border border-rose-800">
                  BLOCKED IN BROWSER
                </span>
              ) : (
                <span className="text-[10px] font-mono bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800">
                  STANDBY
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Instant desktop notifications & sound chimes trigger when AI validates a new Gate 9 TOP TRADE.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => setSoundAlerts((prev) => !prev)}
            className={`p-2 rounded-lg border text-xs transition-colors flex items-center gap-1.5 ${
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
            className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-mono transition-colors"
          >
            Test Alert
          </button>

          {/* Request Permission Button (if not yet granted) */}
          {notificationPermission !== 'granted' && (
            <button
              type="button"
              onClick={handleRequestNotificationPermission}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors shadow-sm"
            >
              Enable Browser Alerts
            </button>
          )}
        </div>
      </div>

      {/* Active Signals Feed */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            Active Validated Trading Signals ({activeSignals.length})
          </h3>

          <div className="flex items-center gap-2 text-xs font-mono">
            {/* Timezone Preference Switcher */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px]">
              <span className="text-slate-500 px-1.5 flex items-center gap-1">
                <Globe className="w-3 h-3 text-slate-400" />
                ZONE:
              </span>
              <button
                type="button"
                onClick={() => setPreferredTimeZone('LOCAL')}
                className={`px-2 py-0.5 rounded transition ${
                  preferredTimeZone === 'LOCAL'
                    ? 'bg-slate-800 text-emerald-400 font-semibold border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Local Browser Time (${getLocalTimeZone()})`}
              >
                Local
              </button>
              <button
                type="button"
                onClick={() => setPreferredTimeZone('EXCHANGE')}
                className={`px-2 py-0.5 rounded transition ${
                  preferredTimeZone === 'EXCHANGE'
                    ? 'bg-slate-800 text-emerald-400 font-semibold border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Exchange Time (New York / Eastern Time)"
              >
                Exchange (ET)
              </button>
              <button
                type="button"
                onClick={() => setPreferredTimeZone('UTC')}
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

            <span className="text-xs font-mono text-slate-400 hidden md:inline">
              Updated: {formatTimeWithZone(Date.now(), preferredTimeZone)}
            </span>
          </div>
        </div>

        {activeSignals.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {activeSignals.map((signal) => (
              <div
                key={signal.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4 hover:border-slate-700 transition"
              >
                {/* Signal Card Top Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-3 py-1 rounded-md text-xs font-bold font-mono flex items-center gap-1.5 ${
                        signal.direction === 'BUY'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-rose-950 text-rose-400 border border-rose-800'
                      }`}
                    >
                      {signal.direction === 'BUY' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {signal.direction}
                    </span>
                    <span className="text-base font-bold font-mono text-white tracking-wider">
                      {signal.symbol}
                    </span>
                    <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-0.5 rounded border border-slate-800">
                      {signal.timeframe}
                    </span>
                    {signal.isBestTrade || signal.rankTier === 'BEST_TRADE' ? (
                      <span className="text-[10px] font-bold font-mono bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                        ★ BEST TRADE
                      </span>
                    ) : signal.isSecondBest || signal.rankTier === 'SECOND_BEST' ? (
                      <span className="text-[10px] font-bold font-mono bg-emerald-950/90 text-emerald-300 border border-emerald-500/80 px-2.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                        ★ SECOND BEST
                      </span>
                    ) : signal.isSuggestion || signal.rankTier === 'SUGGESTION' ? (
                      <span className="text-[10px] font-bold font-mono bg-sky-950/90 text-sky-300 border border-sky-600/80 px-2 py-0.5 rounded">
                        SUGGESTION
                      </span>
                    ) : signal.isTopTrade ? (
                      <span className="text-[10px] font-bold font-mono bg-amber-950/90 text-amber-300 border border-amber-500/80 px-2.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                        ★ TOP TRADE
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xs:gap-3 text-xs font-mono">
                    {signal.score !== undefined && (
                      <span className="text-slate-400">
                        Score:{' '}
                        <strong className="text-blue-400 font-bold">{signal.score}/100</strong>
                      </span>
                    )}
                    <span className="text-slate-400">
                      Confidence:{' '}
                      <strong className="text-emerald-400 font-bold">{signal.confidenceScore}%</strong>
                    </span>
                    <span className="text-slate-400">
                      Win Rate:{' '}
                      <strong className="text-emerald-400 font-bold">{signal.estimatedWinRate?.toFixed(1) || 'N/A'}%</strong>
                    </span>
                    <span className="text-slate-400">
                      AI:{' '}
                      <strong className={signal.isAiValidated ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                        {signal.isAiValidated ? "Validated" : "UNAVAILABLE"}
                      </strong>
                    </span>
                    <span className="text-slate-400 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                      {signal.dataSource}
                    </span>
                  </div>
                </div>

                {/* Key Numeric Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-4 rounded-lg border border-slate-800/80 font-mono text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px] block">EXACT ENTRY PRICE</span>
                    <span className="text-white font-bold text-sm">{signal.entryPrice}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">STOP LOSS (ATR Volatility)</span>
                    <span className="text-rose-400 font-bold text-sm">
                      {signal.stopLoss}
                      {signal.stopDistance !== undefined && signal.pipPointUnit && (
                        <span className="text-[10px] ml-1 font-normal opacity-70 text-rose-300">
                          (-{signal.stopDistance} {signal.pipPointUnit})
                        </span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block mb-0.5">TAKE PROFIT (TP1 / TP2 / TP3)</span>
                    <div className="flex flex-col gap-0.5 mt-1 bg-emerald-950/20 px-2 py-1 rounded border border-emerald-950/40">
                      <div className="flex items-center justify-between text-[11px] font-bold text-emerald-500/90">
                        <span>TP1 (Conservative):</span>
                        <span>{signal.tp1 || signal.takeProfit}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400">
                        <span>TP2 (Main Target):</span>
                        <span>{signal.tp2 || signal.takeProfit}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-emerald-300">
                        <span>TP3 (Extended):</span>
                        <span>{signal.tp3 || signal.takeProfit}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">RISK / REWARD (NET)</span>
                    <span className="text-blue-400 font-bold text-sm">
                      {signal.riskRewardRatio}:1
                      {signal.estimatedFriction?.netRiskRewardRatio && (
                        <span className="text-[10px] ml-1 font-normal opacity-75 text-sky-300">
                          (Net: {signal.estimatedFriction.netRiskRewardRatio}:1)
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Friction & Execution Realism Specs */}
                {signal.estimatedFriction && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/50 font-mono text-[10px] text-slate-400">
                    <div className="flex justify-between items-center px-1">
                      <span>Est. Spread & Slippage:</span>
                      <strong className="text-slate-200">{signal.estimatedFriction.spreadPlusSlippage}</strong>
                    </div>
                    <div className="flex justify-between items-center px-1 border-t sm:border-t-0 sm:border-l border-slate-800/60 pt-1 sm:pt-0">
                      <span>Friction Cost Ratio:</span>
                      <strong className="text-emerald-400">{signal.estimatedFriction.frictionToProfitPct}% of profit</strong>
                    </div>
                    <div className="flex justify-between items-center px-1 border-t sm:border-t-0 sm:border-l border-slate-800/60 pt-1 sm:pt-0">
                      <span>Min Hurdle Clearance:</span>
                      <strong className="text-emerald-400">Passes Noise Filter</strong>
                    </div>
                  </div>
                )}

                {/* Technical Confluence Reasons */}
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-300 block">
                    Technical Confluence Rationale:
                  </span>
                  <ul className="space-y-1 pl-1">
                    {signal.confluenceReasons.map((reason, idx) => (
                      <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* AI Assessment Rationale Banner */}
                {signal.aiAssessment && (
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 flex items-start gap-2.5">
                    <Cpu className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-white block text-[11px] uppercase tracking-wider mb-0.5">
                        NVIDIA AI Risk Evaluation
                      </span>
                      <p className="text-slate-300 text-xs leading-relaxed">{signal.aiAssessment}</p>
                    </div>
                  </div>
                )}

                {/* Card Footer */}
                <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60 gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      Validated: {formatTimeWithZone(signal.validatedAt || signal.timestamp, preferredTimeZone)}
                    </span>
                    {signal.snapshotId && (
                      <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-slate-400">
                        ID: {signal.snapshotId}
                      </span>
                    )}
                  </div>
                  <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3 h-3" /> Status: ACTIVE (Gate 9 Ranked)
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Empty State when no setup exists */
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center shadow-sm">
            <div className="w-12 h-12 bg-slate-950 border border-slate-800 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-500">
              <Activity className="w-6 h-6 text-slate-400" />
            </div>
            <h4 className="text-sm font-semibold text-white mb-1">
              Awaiting Valid Opportunity Ranking
            </h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto mb-4 leading-relaxed">
              No active signal stored for selected symbol. Click <strong>"Analyze Market & Generate Signal"</strong> above to scan the liquid universe and rank genuine setups.
            </p>
            <div className="inline-flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Gate 9 Rule: TOP TRADE Selection & Risk Correlation Filter</span>
            </div>
          </div>
        )}
      </div>

      {/* Signal History & Alert Log (Last 10 Local State Events) */}
      <SignalHistoryPanel
        history={signalHistory}
        onClearHistory={handleClearHistory}
        onDeleteHistoryItem={handleDeleteHistoryItem}
        preferredTimeZone={preferredTimeZone}
        onSelectSymbol={(sym) => {
          setSelectedSymbol(sym);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* Signal Processing Pipeline Framework */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">
              Signal Engine Architecture (Gate 9 Active)
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            Opportunity Ranking & Selection
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Module 1 */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400">01. INGESTION</span>
              <StatusBadge status="configured" label="Twelve Data Live" />
            </div>
            <div className="flex items-center gap-2 font-medium text-xs text-white pt-1">
              <Database className="w-4 h-4 text-emerald-400" />
              <span>Forex & Crypto Feeds</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Twelve Data (Forex) & Bitget (Crypto) streams active with freshness validation.
            </p>
          </div>

          {/* Module 2 */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400">02. AI ENGINE</span>
              <StatusBadge status={isNvidiaConfigured ? 'configured' : 'standby'} label={isNvidiaConfigured ? 'NVIDIA API Active' : 'NVIDIA Standby'} />
            </div>
            <div className="flex items-center gap-2 font-medium text-xs text-white pt-1">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>NVIDIA Risk AI</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Evaluates calculated technical setup quality and risk factors.
            </p>
          </div>

          {/* Module 3 */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400">03. STRATEGY</span>
              <StatusBadge status="configured" label="Multi-TF Confluence" />
            </div>
            <div className="flex items-center gap-2 font-medium text-xs text-white pt-1">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Confluence Engine</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Multi-timeframe EMA, RSI, MACD, and ATR indicator confluence checks.
            </p>
          </div>

          {/* Module 4 */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400">04. HARDENED VALIDATOR</span>
              <StatusBadge status="configured" label="Gate 8 Active" />
            </div>
            <div className="flex items-center gap-2 font-medium text-xs text-white pt-1">
              <CheckCircle2 className="w-4 h-4 text-blue-400" />
              <span>Signal Validator</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Enforces freshness, cross-source price check, OHLC candle geometry, and SL/TP sanity.
            </p>
          </div>
        </div>
      </div>

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
    </div>
  );
}
