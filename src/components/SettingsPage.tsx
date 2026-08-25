/**
 * SETTINGS Page Component (Gate 1 Foundation)
 *
 * CRITICAL SECURITY REQUIREMENT:
 * Sensitive API keys are read strictly from server environment variables.
 * They are NEVER stored in localStorage or exposed in frontend JavaScript.
 */

import { useState, useEffect, useCallback } from 'react';
import { MarketStatusResponse } from '../types/index.js';
import { api } from '../api/client.js';
import { StatusBadge } from './StatusBadge.js';
import { MarketDiagnostics } from './MarketDiagnostics.js';
import { NotificationService, NotificationPermissionStatus } from '../utils/notification.js';
import {
  ShieldCheck,
  BellRing,
  Volume2,
  VolumeX,
  Clock,
  RefreshCw,
  Coins,
  Globe2,
  LineChart,
  FileSpreadsheet,
  FileCode,
  ChevronDown,
  ChevronUp,
  Download,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Calendar,
} from 'lucide-react';

interface SettingsPageProps {
  // No props needed
}

export function SettingsPage({}: SettingsPageProps) {
  const [marketStatus, setMarketStatus] = useState<MarketStatusResponse | null>(null);
  const [loadingMarketStatus, setLoadingMarketStatus] = useState<boolean>(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionStatus>(
    NotificationService.getPermission()
  );
  const [pushActionMessage, setPushActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [soundAlerts, setSoundAlerts] = useState<boolean>(true);
  const [scannerSettings, setScannerSettings] = useState<{
    enabled: boolean;
    notificationsEnabled: boolean;
    intervalMinutes: number;
    signalsSentTimestamps: number[];
    lastScanTime: number;
    nextScanTime: number;
    scannerStatus: 'ACTIVE' | 'RUNNING' | 'DISABLED' | 'CAP_REACHED';
    limit: number;
    dailySignalCount?: number;
    lastCronExecution?: number;
    lastAutomatedScan?: number;
    lastScanCompletedAt?: number;
    lastScanDuration?: number;
    lastCandidatesEvaluated?: number;
    lastSignalsFound?: number;
    lastAcceptedSignals?: number;
    nextCronExecution?: number;
    universeSymbolsScanned?: number;
    preliminaryCandidatesFound?: number;
    candidatesRejectedPreliminary?: number;
    candidatesEvaluated?: number;
    candidatesRejectedFinal?: number;
    signalsGenerated?: number;
    signalsAccepted?: number;
    capState?: {
      universeSymbolsScanned?: number;
      candidatesEvaluated?: number;
      signalsGenerated?: number;
      signalsAccepted?: number;
    };
  } | null>(null);
  const [cronJobOrg, setCronJobOrg] = useState<{
    configured: boolean;
    enabled?: boolean;
    statusText?: string;
    schedule?: { intervalDescription?: string; timezone?: string };
    lastExecution?: { timestamp: number; dateIso: string; httpStatus?: number; durationMs?: number } | null;
    nextExecution?: { timestamp: number; dateIso: string } | null;
    error?: string;
    success?: boolean;
  } | null>(null);
  const [lastValidCronJobOrg, setLastValidCronJobOrg] = useState<any>(null);
  const [cronHistory, setCronHistory] = useState<{
    records: any[];
    totalScansCompleted: number;
    totals: any;
    latestScan: any;
    hasTelemetry: boolean;
  } | null>(null);
  const [expandedScanId, setExpandedScanId] = useState<string | null>(null);
  const [expandedReasonsAsset, setExpandedReasonsAsset] = useState<string | null>(null);
  const [loadingScanner, setLoadingScanner] = useState<boolean>(false);
  const [scannerMessage, setScannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const latestScanRecord = cronHistory?.latestScan || scannerSettings?.latestCronScan;
  const hasCronTelemetry = Boolean(latestScanRecord || cronHistory?.hasTelemetry);

  const fetchScannerSettings = useCallback(async () => {
    setLoadingScanner(true);
    try {
      const [res, historyRes] = await Promise.all([
        api.getScannerSettings(),
        api.getCron24hHistory().catch(() => null),
      ]);
      if (res.success) {
        setScannerSettings(res.settings);
        if (res.cronJobOrg) {
          setCronJobOrg(res.cronJobOrg);
          if (res.cronJobOrg.success !== false) {
            setLastValidCronJobOrg(res.cronJobOrg);
          }
        }
      }
      if (historyRes && historyRes.success) {
        setCronHistory(historyRes);
      }
    } catch (err) {
      console.error('Failed to fetch scanner settings:', err);
    } finally {
      setLoadingScanner(false);
    }
  }, []);

  const handleUpdateScanner = async (
    enabled: boolean,
    notificationsEnabled: boolean,
    intervalMinutes?: number
  ) => {
    try {
      const currentInterval = intervalMinutes ?? scannerSettings?.intervalMinutes ?? 30;
      const res = await api.updateScannerSettings(enabled, notificationsEnabled, false, currentInterval);
      if (res.success) {
        setScannerSettings(res.settings);
        setScannerMessage({ type: 'success', text: 'Scanner configuration updated successfully.' });
        setTimeout(() => setScannerMessage(null), 4000);
      }
    } catch (err: any) {
      console.error('Failed to update scanner settings:', err);
      setScannerMessage({
        type: 'error',
        text: err?.message || 'Failed to update scanner settings.',
      });
      setTimeout(() => setScannerMessage(null), 6000);
    }
  };

  const handleTestAlert = async () => {
    setPushActionMessage(null);
    try {
      const result = await NotificationService.sendTestAlert();
      setNotificationPermission(NotificationService.getPermission());
      if (result.success) {
        setPushActionMessage({ type: 'success', text: result.message });
      } else {
        setPushActionMessage({ type: 'error', text: result.message });
      }
    } catch (err: any) {
      setPushActionMessage({ type: 'error', text: err?.message || 'Test alert failed' });
    }
    setTimeout(() => setPushActionMessage(null), 5000);
  };

  const fetchMarketStatus = useCallback(async () => {
    setLoadingMarketStatus(true);
    try {
      const data = await api.getMarketStatus();
      setMarketStatus(data);
    } catch (err) {
      console.error('Failed to fetch market provider status:', err);
    } finally {
      setLoadingMarketStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchMarketStatus();
    fetchScannerSettings();
    setNotificationPermission(NotificationService.getPermission());
  }, [fetchMarketStatus, fetchScannerSettings]);

  const activeMarketProviders = marketStatus?.providers;

  const getProviderConnectionBadge = (providerId: string) => {
    if (!activeMarketProviders || !activeMarketProviders[providerId]) {
      return <StatusBadge status="unconfigured" label="NOT VERIFIED" />;
    }
    const info = activeMarketProviders[providerId];
    if (info.status === 'CONNECTED') {
      return <StatusBadge status="ok" label="CONNECTED" />;
    }
    return <StatusBadge status="error" label="UNAVAILABLE" />;
  };

  return (
    <div className="space-y-6">
      {/* Security Architecture Callout */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-slate-200">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-slate-800 rounded-lg text-emerald-400 mt-0.5 border border-slate-700">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              Gate 1 &bull; Secure Environment Architecture
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              All live financial data feeds (Bitget, Finnhub, Twelve Data) and NVIDIA AI API are securely proxied through verified server routes.
            </p>
          </div>
        </div>
      </div>

      {/* Market Data Provider Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              Market Data Feeds & API Integration Status
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Live connection verification across market liquidity and AI intelligence providers
            </p>
          </div>

          <button
            type="button"
            onClick={fetchMarketStatus}
            disabled={loadingMarketStatus}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono transition-colors flex items-center gap-1.5 disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMarketStatus ? 'animate-spin' : ''}`} />
            <span>{loadingMarketStatus ? 'Checking...' : 'Check Feeds'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Bitget (Crypto)</span>
              {getProviderConnectionBadge('bitget')}
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Type: Primary Crypto &bull; Key: Public API
            </p>
            {activeMarketProviders?.bitget?.errorMessage && (
              <p className="text-[10px] text-amber-400 font-mono">
                {activeMarketProviders.bitget.errorMessage}
              </p>
            )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Finnhub (Multi-Asset)</span>
              {getProviderConnectionBadge('finnhub')}
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Type: Multi-Asset &bull; Key: FINNHUB_API_KEY
            </p>
            {activeMarketProviders?.finnhub?.errorMessage && (
              <p className="text-[10px] text-amber-400 font-mono">
                {activeMarketProviders.finnhub.errorMessage}
              </p>
            )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Twelve Data (Forex)</span>
              {getProviderConnectionBadge('twelvedata')}
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Type: Forex Feeds &bull; Key: TWELVE_DATA_API_KEY
            </p>
            {activeMarketProviders?.twelvedata?.errorMessage && (
              <p className="text-[10px] text-amber-400 font-mono">
                {activeMarketProviders.twelvedata.errorMessage}
              </p>
            )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">NVIDIA AI (Inference)</span>
              {getProviderConnectionBadge('nvidia')}
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Type: AI Inference &bull; Key: NVIDIA_API_KEY
            </p>
            {activeMarketProviders?.nvidia?.errorMessage && (
              <p className="text-[10px] text-amber-400 font-mono">
                {activeMarketProviders.nvidia.errorMessage}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Live Market Diagnostics Component */}
      <MarketDiagnostics />

      {/* Browser Notifications & Audio Alerts */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <BellRing className="w-4 h-4 text-emerald-400" />
              Browser Notifications & Audio Alerts
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Instant desktop notifications and synthetic audio chimes for verified Gate 9 TOP TRADEs
            </p>
          </div>

          <div className="flex items-center gap-2">
            {notificationPermission === 'granted' ? (
              <StatusBadge status="configured" label="PERMISSION GRANTED" />
            ) : notificationPermission === 'denied' ? (
              <StatusBadge status="error" label="BLOCKED IN BROWSER" />
            ) : (
              <StatusBadge status="unconfigured" label="ACTION REQUIRED" />
            )}
          </div>
        </div>

        {pushActionMessage && (
          <div className={`mb-4 p-3 rounded-lg text-xs flex items-center gap-2 ${
            pushActionMessage.type === 'success' 
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            <span className="font-semibold">{pushActionMessage.type === 'success' ? 'Success:' : 'Alert:'}</span>
            <span>{pushActionMessage.text}</span>
          </div>
        )}

        <div className="space-y-4">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-white block">Desktop & Audio Alert System</span>
              <p className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">
                Click Test Alert to verify browser notification permissions and audio chime playback.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSoundAlerts((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors flex items-center gap-1.5 ${
                  soundAlerts
                    ? 'bg-slate-900 border-slate-700 text-emerald-400'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
              >
                {soundAlerts ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{soundAlerts ? 'AUDIO ON' : 'AUDIO OFF'}</span>
              </button>

              <button
                type="button"
                onClick={handleTestAlert}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors shadow-sm"
              >
                Test Alert
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AUTOMATED MARKET SCANNER (HARD GATE — COMPACT CRON SCANNER CARD) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
              <Clock className="w-4 h-4 text-emerald-400" />
              AUTOMATED MARKET SCANNER
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Read-only operational cron state synchronized with cron-job.org
            </p>
          </div>

          <div className="flex items-center gap-3">
            {cronJobOrg && cronJobOrg.success === false && lastValidCronJobOrg && (
              <span className="px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[11px] font-mono flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Sync unavailable
              </span>
            )}
            <button
              type="button"
              onClick={fetchScannerSettings}
              disabled={loadingScanner}
              title="Refresh backend state"
              className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5 font-mono"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingScanner ? 'animate-spin' : ''}`} />
              <span>Refresh State</span>
            </button>
          </div>
        </div>

        {(() => {
          const isCronConfigured = cronJobOrg?.configured !== false;
          const isCronQuerySuccess = cronJobOrg && cronJobOrg.success !== false;

          let resultVal = 'UNKNOWN';
          let latestExecution = null;
          let isVerified = false;
          let lastVerifiedResult = 'UNKNOWN';

          // Use either active API response or the cached last valid one
          const activeCron = isCronQuerySuccess ? cronJobOrg : lastValidCronJobOrg;

          if (activeCron) {
            const executions = [];
            if (activeCron.lastExecution) {
              executions.push(activeCron.lastExecution);
            }
            if (activeCron.recentHistory && Array.isArray(activeCron.recentHistory)) {
              executions.push(...activeCron.recentHistory);
            }

            // De-duplicate execution list by timestamp to find the absolute latest run
            const uniqueExecs = new Map<number, any>();
            for (const exec of executions) {
              if (exec && exec.timestamp) {
                uniqueExecs.set(exec.timestamp, exec);
              }
            }

            const sorted = Array.from(uniqueExecs.values()).sort((a, b) => b.timestamp - a.timestamp);
            latestExecution = sorted[0] || null;

            if (latestExecution) {
              isVerified = true;
              const statusNumOrStr = latestExecution.status;
              const sStr = String(statusNumOrStr).trim().toUpperCase();
              const sNum = Number(statusNumOrStr);

              // Standard cron-job.org execution status mapping:
              // 0 -> Unknown / not executed yet (UNKNOWN)
              // 1 -> OK (SUCCESS)
              // 2 -> Failed (DNS error) (FAILED)
              // 3 -> Failed (could not connect to host) (FAILED)
              // 4 -> Failed (HTTP error) (FAILED)
              // 5 -> Failed (timeout) (TIMEOUT)
              // 6 -> Failed (unknown error) (FAILED)
              if (sStr === 'RUNNING' || sStr === 'EXECUTING') {
                lastVerifiedResult = 'RUNNING';
              } else if (sStr === 'OK' || sStr === 'SUCCESS' || sStr === '1' || sNum === 1) {
                lastVerifiedResult = 'SUCCESS';
              } else if (sStr === 'TIMEOUT' || sStr === '5' || sNum === 5) {
                lastVerifiedResult = 'TIMEOUT';
              } else if (sStr === '2' || sNum === 2 || sStr === '3' || sNum === 3 || sStr === '4' || sNum === 4 || sStr === '6' || sNum === 6 || sStr === 'FAILED' || sStr === 'ERROR') {
                lastVerifiedResult = 'FAILED';
              } else {
                lastVerifiedResult = 'UNKNOWN';
              }
            }
          }

          if (isCronQuerySuccess) {
            resultVal = lastVerifiedResult;
          } else {
            resultVal = 'CRON STATUS UNAVAILABLE';
          }

          const isEnabled = activeCron?.enabled ?? (scannerSettings?.enabled !== false);
          let statusVal = 'UNKNOWN';
          if (!isCronConfigured) {
            statusVal = 'UNCONFIGURED';
          } else if (!isCronQuerySuccess && !lastValidCronJobOrg) {
            statusVal = 'UNAVAILABLE';
          } else {
            statusVal = activeCron?.status === 0 || isEnabled === false ? 'DISABLED' : (activeCron?.status === 3 ? 'FAILED' : 'ACTIVE');
          }

          const scheduleVal = activeCron?.schedule?.intervalDescription || 'Every 30 minutes';

          const lastScanTs = latestExecution?.timestamp ?? 0;
          const lastScanTimeStr = lastScanTs > 0 ? new Date(lastScanTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Never';
          const lastScanFullStr = lastScanTs > 0 ? new Date(lastScanTs).toLocaleString() : 'No execution recorded';

          const nextScanTs = activeCron?.nextExecution?.timestamp ?? 0;
          const nextScanTimeStr = nextScanTs > 0 ? new Date(nextScanTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Pending';
          const nextScanFullStr = nextScanTs > 0 ? new Date(nextScanTs).toLocaleString() : 'Pending';

          const durationMs = latestExecution?.durationMs ?? latestExecution?.duration ?? 0;
          const durationStr = durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : '0.0s';

          // Correlate the cron execution with the server-side scanner results
          let correlatedRecord = null;
          const recordsList = cronHistory?.records || [];
          if (latestExecution && latestExecution.timestamp && recordsList.length > 0) {
            const cronTs = latestExecution.timestamp;
            let minDiff = Infinity;
            for (const rec of recordsList) {
              const diff = Math.abs(rec.timestamp - cronTs);
              if (diff < minDiff && diff < 120000) { // maximum 120s tolerance window
                minDiff = diff;
                correlatedRecord = rec;
              }
            }
          }

          const latestScanRecord = cronHistory?.latestScan || scannerSettings?.latestCronScan;

          const assetsScannedVal = correlatedRecord 
            ? correlatedRecord.totalUniverseSymbolsScanned 
            : (latestScanRecord?.totalUniverseSymbolsScanned ?? latestScanRecord?.universeSymbolsScanned ?? scannerSettings?.capState?.universeSymbolsScanned ?? scannerSettings?.universeSymbolsScanned ?? 0);

          const candidatesEvaluatedVal = correlatedRecord 
            ? correlatedRecord.totalCandidatesEvaluated 
            : (latestScanRecord?.totalCandidatesEvaluated ?? latestScanRecord?.candidatesEvaluated ?? 0);

          const signalsFoundVal = correlatedRecord 
            ? correlatedRecord.totalSignalsFound 
            : (latestScanRecord?.totalSignalsFound ?? latestScanRecord?.signalsGenerated ?? latestScanRecord?.signalsFound ?? scannerSettings?.capState?.signalsGenerated ?? scannerSettings?.lastSignalsFound ?? 0);

          const signalsAcceptedVal = correlatedRecord 
            ? correlatedRecord.totalSignalsAccepted 
            : (latestScanRecord?.totalSignalsAccepted ?? latestScanRecord?.signalsAccepted ?? scannerSettings?.capState?.signalsAccepted ?? scannerSettings?.lastAcceptedSignals ?? 0);

          const scanOutcomeVal = correlatedRecord?.status ?? latestScanRecord?.status ?? 'UNKNOWN';

          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 font-mono text-xs">
              {/* 1. Scheduler */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Scheduler</span>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-semibold text-slate-100 truncate">cron-job.org</span>
                </div>
              </div>

              {/* 2. Status */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Status</span>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className={`w-2 h-2 rounded-full ${
                    statusVal === 'ACTIVE' ? 'bg-emerald-400' : statusVal === 'FAILED' ? 'bg-red-400' : 'bg-amber-400'
                  }`} />
                  <span className={`font-semibold truncate ${
                    statusVal === 'ACTIVE' ? 'text-emerald-400' : statusVal === 'FAILED' ? 'text-red-400' : 'text-amber-400'
                  }`}>{statusVal}</span>
                </div>
              </div>

              {/* 3. Schedule */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Schedule</span>
                <span className="font-semibold text-white block pt-0.5 truncate" title={scheduleVal}>
                  {scheduleVal}
                </span>
              </div>

              {/* 4. Last Execution */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Last Execution</span>
                <span className="font-semibold text-slate-200 block pt-0.5 truncate" title={lastScanFullStr}>
                  {lastScanTimeStr}
                </span>
              </div>

              {/* 5. Next Execution */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Next Execution</span>
                <span className="font-semibold text-emerald-400 block pt-0.5 truncate" title={nextScanFullStr}>
                  {nextScanTimeStr}
                </span>
              </div>

              {/* 6. Execution Duration */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Execution Duration</span>
                <span className="font-semibold text-slate-200 block pt-0.5 truncate">
                  {durationStr}
                </span>
              </div>

              {/* 7. Execution Result */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Execution Result</span>
                {resultVal === 'CRON STATUS UNAVAILABLE' ? (
                  <div className="space-y-0.5">
                    <span className="text-red-400 block font-semibold leading-tight text-[11px]" title="CRON STATUS UNAVAILABLE">CRON UNAVAILABLE</span>
                    {isVerified && (
                      <span className="text-[9px] text-slate-400 block leading-tight">
                        Last: <span className="font-bold text-emerald-400">{lastVerifiedResult}</span>
                      </span>
                    )}
                  </div>
                ) : (
                  <span className={`font-semibold block pt-0.5 truncate ${
                    resultVal === 'SUCCESS' ? 'text-emerald-400' : resultVal === 'TIMEOUT' ? 'text-amber-400' : resultVal === 'RUNNING' ? 'text-blue-400' : 'text-red-400'
                  }`}>
                    {resultVal}
                  </span>
                )}
              </div>

              {/* 8. Assets Scanned */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Assets Scanned</span>
                <span className="font-semibold text-slate-200 block pt-0.5 truncate">
                  {assetsScannedVal}
                </span>
              </div>

              {/* 9. Candidates Evaluated */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Candidates Evaluated</span>
                <span className="font-semibold text-slate-200 block pt-0.5 truncate">
                  {candidatesEvaluatedVal}
                </span>
              </div>

              {/* 10. Signals Found */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Signals Found</span>
                <span className="font-semibold text-blue-400 block pt-0.5 truncate">
                  {signalsFoundVal}
                </span>
              </div>

              {/* 11. Signals Accepted */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Signals Accepted</span>
                <span className="font-semibold text-emerald-400 block pt-0.5 truncate">
                  {signalsAcceptedVal}
                </span>
              </div>

              {/* 12. Scan Outcome */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Scan Outcome</span>
                <span className={`font-semibold block pt-0.5 truncate ${
                  scanOutcomeVal === 'SUCCESS' ? 'text-emerald-400' : scanOutcomeVal === 'TIMEOUT' ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {scanOutcomeVal}
                </span>
              </div>
            </div>
          );
        })()}
      </div>



                {/* 24-HOUR MULTI-ASSET SCAN RECORD & EXPORT SECTION */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex items-center justify-between font-mono">
                  <div>
                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-emerald-400" />
                      24-HOUR MULTI-ASSET SCAN RECORD
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 font-sans">
                      Export immutable rolling 24-hour cron scan history & reports
                    </p>
                  </div>

                  {/* Report Download Buttons */}
                  <div className="flex items-center gap-2">
                    <a
                      href="/api/scanner/export-24h-report?format=csv"
                      download
                      title="Download 24-Hour Scan History as CSV"
                      className="p-2 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800/80 text-emerald-300 transition-colors flex items-center justify-center"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    </a>
                    <a
                      href="/api/scanner/export-24h-report?format=json"
                      download
                      title="Download 24-Hour Scan History as JSON"
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-colors flex items-center justify-center"
                    >
                      <FileCode className="w-4 h-4 text-blue-400" />
                    </a>
                  </div>
                </div>
              </div>
    );
}
