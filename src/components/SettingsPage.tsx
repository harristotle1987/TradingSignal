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
    lastExecution?: { timestamp: number; dateIso: string; httpStatus?: number } | null;
    nextExecution?: { timestamp: number; dateIso: string } | null;
    error?: string;
  } | null>(null);
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

      {/* AUTOMATED MARKET SCANNER (HARD GATE 3 — READ-ONLY CRON-DRIVEN STATE) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
              <Clock className="w-4 h-4 text-emerald-400" />
              AUTOMATED MARKET SCANNER
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Read-only cron-driven market scanner state synchronized with cron-job.org
            </p>
          </div>

          <div className="flex items-center gap-2">
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

        <div className="space-y-4 font-mono text-xs">
          {(() => {
            const isCronConfigured = Boolean(cronJobOrg?.configured);
            const latestScanRecord = cronHistory?.latestScan || scannerSettings?.latestCronScan;

            const lastCronTimestamp =
              (cronJobOrg?.lastExecution?.timestamp && cronJobOrg.lastExecution.timestamp > 0)
                ? cronJobOrg.lastExecution.timestamp
                : (scannerSettings?.lastCronExecution && scannerSettings.lastCronExecution > 0)
                ? scannerSettings.lastCronExecution
                : (scannerSettings?.lastAutomatedScan && scannerSettings.lastAutomatedScan > 0)
                ? scannerSettings.lastAutomatedScan
                : (scannerSettings?.lastScanCompletedAt && scannerSettings.lastScanCompletedAt > 0)
                ? scannerSettings.lastScanCompletedAt
                : (latestScanRecord?.timestamp && latestScanRecord.timestamp > 0)
                ? latestScanRecord.timestamp
                : 0;

            const hasCronTelemetry = lastCronTimestamp > 0 || Boolean(latestScanRecord) || Boolean(cronHistory?.hasTelemetry);

            let schedulerDisplay = 'Awaiting cron telemetry';
            if (isCronConfigured || hasCronTelemetry) {
              schedulerDisplay = 'cron-job.org';
            }

            let statusDisplay = 'Awaiting cron telemetry';
            if (isCronConfigured || hasCronTelemetry || scannerSettings) {
              if (cronJobOrg?.statusText === 'ACTIVE' || cronJobOrg?.enabled === true) {
                statusDisplay = 'ACTIVE';
              } else if (cronJobOrg?.statusText) {
                statusDisplay = cronJobOrg.statusText;
              } else if (cronJobOrg?.enabled === false) {
                statusDisplay = 'INACTIVE';
              } else {
                statusDisplay = scannerSettings?.enabled !== false ? 'ACTIVE' : 'INACTIVE';
              }
            }

            let scheduleDisplay = 'Awaiting cron telemetry';
            if (isCronConfigured || hasCronTelemetry || scannerSettings) {
              if (cronJobOrg?.schedule?.intervalDescription) {
                scheduleDisplay = cronJobOrg.schedule.intervalDescription;
              } else {
                scheduleDisplay = `Every ${scannerSettings?.intervalMinutes ?? 30} minutes`;
              }
            }

            const lastScanFormattedTime = hasCronTelemetry && lastCronTimestamp > 0
              ? new Date(lastCronTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : 'Awaiting cron telemetry';

            const lastScanFullString = hasCronTelemetry && lastCronTimestamp > 0
              ? new Date(lastCronTimestamp).toLocaleString()
              : 'Awaiting cron telemetry';

            const nextCronTimestamp =
              (cronJobOrg?.nextExecution?.timestamp && cronJobOrg.nextExecution.timestamp > 0)
                ? cronJobOrg.nextExecution.timestamp
                : (scannerSettings?.nextCronExecution && scannerSettings.nextCronExecution > 0)
                ? scannerSettings.nextCronExecution
                : (scannerSettings?.nextScanTime && scannerSettings.nextScanTime > 0)
                ? scannerSettings.nextScanTime
                : (lastCronTimestamp > 0 ? lastCronTimestamp + (scannerSettings?.intervalMinutes || 30) * 60 * 1000 : 0);

            const nextScanFormattedTime = hasCronTelemetry && nextCronTimestamp > 0
              ? new Date(nextCronTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : 'Awaiting cron telemetry';

            const nextScanFullString = hasCronTelemetry && nextCronTimestamp > 0
              ? new Date(nextCronTimestamp).toLocaleString()
              : 'Awaiting cron telemetry';

            const universeSymbolsScannedVal = scannerSettings?.capState?.universeSymbolsScanned ?? scannerSettings?.universeSymbolsScanned;
            const candidatesEvaluatedVal = scannerSettings?.capState?.candidatesEvaluated ?? scannerSettings?.candidatesEvaluated ?? scannerSettings?.lastCandidatesEvaluated;
            const signalsGeneratedVal = scannerSettings?.capState?.signalsGenerated ?? scannerSettings?.signalsGenerated ?? scannerSettings?.lastSignalsFound;
            const signalsAcceptedVal = scannerSettings?.capState?.signalsAccepted ?? scannerSettings?.signalsAccepted ?? scannerSettings?.lastAcceptedSignals;

            return (
              <>
                {/* Main Display Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {/* Scheduler */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Scheduler</span>
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className={`w-2 h-2 rounded-full ${isCronConfigured ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                      <span className="font-semibold text-slate-100 text-sm truncate" title={schedulerDisplay}>{schedulerDisplay}</span>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Status</span>
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className={`w-2 h-2 rounded-full ${
                        statusDisplay === 'ACTIVE'
                          ? 'bg-emerald-400'
                          : statusDisplay === 'Awaiting cron telemetry'
                          ? 'bg-slate-500'
                          : 'bg-amber-400'
                      }`} />
                      <span className={`font-semibold text-sm truncate ${
                        statusDisplay === 'ACTIVE'
                          ? 'text-emerald-400'
                          : statusDisplay === 'Awaiting cron telemetry'
                          ? 'text-slate-400'
                          : 'text-amber-400'
                      }`} title={statusDisplay}>
                        {statusDisplay}
                      </span>
                    </div>
                  </div>

                  {/* Schedule */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Schedule</span>
                    <span className="font-semibold text-white block pt-0.5 text-xs truncate" title={scheduleDisplay}>
                      {scheduleDisplay}
                    </span>
                  </div>

                  {/* Last Automated Scan */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Last Automated Scan</span>
                    <span className="font-semibold text-slate-200 block pt-0.5 truncate text-xs" title={lastScanFullString}>
                      {lastScanFormattedTime}
                    </span>
                  </div>

                  {/* Next Scheduled Trigger */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
                    <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Next Scheduled Trigger</span>
                    <span className="font-semibold text-emerald-400 block pt-0.5 truncate text-xs" title={nextScanFullString}>
                      {nextScanFormattedTime}
                    </span>
                  </div>
                </div>

                {/* THREE SEPARATE ASSET CLASS SCAN CARDS: CRYPTO SCAN, FOREX SCAN, STOCKS SCAN */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-400" />
                      LATEST AUTOMATED SCAN BY ASSET CLASS
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {hasCronTelemetry && scannerSettings?.lastScanDuration
                        ? `Duration: ${(scannerSettings.lastScanDuration / 1000).toFixed(1)}s`
                        : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* CRYPTO SCAN CARD */}
                    {(() => {
                      const latestScanRecord = cronHistory?.latestScan || scannerSettings?.latestCronScan;
                      const cryptoData = latestScanRecord?.crypto;
                      const hasCryptoData = Boolean(hasCronTelemetry && cryptoData);

                      return (
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                              <Coins className="w-4 h-4 text-amber-400" />
                              CRYPTO SCAN
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">Spot & Perp</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Assets Scanned</span>
                              <span className="font-bold text-slate-200 block truncate mt-0.5">
                                {hasCryptoData ? `${cryptoData.assetsScanned} scanned` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Candidates Evaluated</span>
                              <span className="font-bold text-slate-200 block truncate mt-0.5">
                                {hasCryptoData ? `${cryptoData.candidatesEvaluated} evaluated` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Signals Found</span>
                              <span className="font-bold text-blue-400 block truncate mt-0.5">
                                {hasCryptoData ? `${cryptoData.signalsFound} found` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Signals Accepted</span>
                              <span className="font-bold text-emerald-400 block truncate mt-0.5">
                                {hasCryptoData ? `${cryptoData.signalsAccepted} accepted` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                          </div>

                          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">Rejected Candidates</span>
                              <span className="font-bold text-slate-300">
                                {hasCryptoData ? `${cryptoData.rejected} rejected` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            {hasCryptoData && cryptoData.rejectionReasons && cryptoData.rejectionReasons.length > 0 && (
                              <div className="pt-1.5 space-y-1 border-t border-slate-800/60 max-h-28 overflow-y-auto pr-1 text-[10px]">
                                {cryptoData.rejectionReasons.map((rej: any, idx: number) => (
                                  <div key={idx} className="flex items-start gap-1 text-slate-400">
                                    <span className="text-amber-400 font-semibold">{rej.symbol}{rej.direction ? ` [${rej.direction}]` : ''}:</span>
                                    <span className="truncate">{rej.reason}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* FOREX SCAN CARD */}
                    {(() => {
                      const latestScanRecord = cronHistory?.latestScan || scannerSettings?.latestCronScan;
                      const forexData = latestScanRecord?.forex;
                      const hasForexData = Boolean(hasCronTelemetry && forexData);

                      return (
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                              <Globe2 className="w-4 h-4 text-emerald-400" />
                              FOREX SCAN
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">Interbank Pairs</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Assets Scanned</span>
                              <span className="font-bold text-slate-200 block truncate mt-0.5">
                                {hasForexData ? `${forexData.assetsScanned} scanned` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Candidates Evaluated</span>
                              <span className="font-bold text-slate-200 block truncate mt-0.5">
                                {hasForexData ? `${forexData.candidatesEvaluated} evaluated` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Signals Found</span>
                              <span className="font-bold text-blue-400 block truncate mt-0.5">
                                {hasForexData ? `${forexData.signalsFound} found` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Signals Accepted</span>
                              <span className="font-bold text-emerald-400 block truncate mt-0.5">
                                {hasForexData ? `${forexData.signalsAccepted} accepted` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                          </div>

                          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">Rejected Candidates</span>
                              <span className="font-bold text-slate-300">
                                {hasForexData ? `${forexData.rejected} rejected` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            {hasForexData && forexData.rejectionReasons && forexData.rejectionReasons.length > 0 && (
                              <div className="pt-1.5 space-y-1 border-t border-slate-800/60 max-h-28 overflow-y-auto pr-1 text-[10px]">
                                {forexData.rejectionReasons.map((rej: any, idx: number) => (
                                  <div key={idx} className="flex items-start gap-1 text-slate-400">
                                    <span className="text-emerald-400 font-semibold">{rej.symbol}{rej.direction ? ` [${rej.direction}]` : ''}:</span>
                                    <span className="truncate">{rej.reason}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* STOCKS SCAN CARD */}
                    {(() => {
                      const latestScanRecord = cronHistory?.latestScan || scannerSettings?.latestCronScan;
                      const stocksData = latestScanRecord?.stocks;
                      const hasStocksData = Boolean(hasCronTelemetry && stocksData);

                      return (
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                              <LineChart className="w-4 h-4 text-blue-400" />
                              STOCKS SCAN
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">US Equities</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Assets Scanned</span>
                              <span className="font-bold text-slate-200 block truncate mt-0.5">
                                {hasStocksData ? `${stocksData.assetsScanned} scanned` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Candidates Evaluated</span>
                              <span className="font-bold text-slate-200 block truncate mt-0.5">
                                {hasStocksData ? `${stocksData.candidatesEvaluated} evaluated` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Signals Found</span>
                              <span className="font-bold text-blue-400 block truncate mt-0.5">
                                {hasStocksData ? `${stocksData.signalsFound} found` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-500 font-sans block">Signals Accepted</span>
                              <span className="font-bold text-emerald-400 block truncate mt-0.5">
                                {hasStocksData ? `${stocksData.signalsAccepted} accepted` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                          </div>

                          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">Rejected Candidates</span>
                              <span className="font-bold text-slate-300">
                                {hasStocksData ? `${stocksData.rejected} rejected` : 'Awaiting cron telemetry'}
                              </span>
                            </div>
                            {hasStocksData && stocksData.rejectionReasons && stocksData.rejectionReasons.length > 0 && (
                              <div className="pt-1.5 space-y-1 border-t border-slate-800/60 max-h-28 overflow-y-auto pr-1 text-[10px]">
                                {stocksData.rejectionReasons.map((rej: any, idx: number) => (
                                  <div key={idx} className="flex items-start gap-1 text-slate-400">
                                    <span className="text-blue-400 font-semibold">{rej.symbol}{rej.direction ? ` [${rej.direction}]` : ''}:</span>
                                    <span className="truncate">{rej.reason}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* 24-HOUR MULTI-ASSET SCAN RECORD & EXPORT SECTION */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 font-mono">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-emerald-400" />
                        24-HOUR MULTI-ASSET SCAN RECORD
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-sans">
                        Immutable rolling 24-hour cron scan history & report generation
                      </p>
                    </div>

                    {/* Report Download Buttons */}
                    <div className="flex items-center gap-2">
                      <a
                        href="/api/scanner/export-24h-report?format=csv"
                        download
                        title="Download 24-Hour Scan History as CSV"
                        className="px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800/80 text-emerald-300 text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Download CSV</span>
                      </a>
                      <a
                        href="/api/scanner/export-24h-report?format=json"
                        download
                        title="Download 24-Hour Scan History as JSON"
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        <FileCode className="w-3.5 h-3.5 text-blue-400" />
                        <span>Download JSON</span>
                      </a>
                    </div>
                  </div>

                  {/* 24-Hour Aggregated Totals Grid */}
                  {cronHistory?.totals ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-amber-400 uppercase font-bold">
                          <span>CRYPTO 24H TOTALS</span>
                          <Coins className="w-3.5 h-3.5" />
                        </div>
                        <div className="text-xs text-slate-300 space-y-0.5 pt-1">
                          <div className="flex justify-between"><span>Assets Scanned:</span> <span className="font-bold text-white">{cronHistory.totals.crypto?.assetsScanned ?? 0}</span></div>
                          <div className="flex justify-between"><span>Evaluated:</span> <span className="font-bold text-white">{cronHistory.totals.crypto?.candidatesEvaluated ?? 0}</span></div>
                          <div className="flex justify-between"><span>Signals Found:</span> <span className="font-bold text-blue-400">{cronHistory.totals.crypto?.signalsFound ?? 0}</span></div>
                          <div className="flex justify-between"><span>Accepted:</span> <span className="font-bold text-emerald-400">{cronHistory.totals.crypto?.signalsAccepted ?? 0}</span></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-emerald-400 uppercase font-bold">
                          <span>FOREX 24H TOTALS</span>
                          <Globe2 className="w-3.5 h-3.5" />
                        </div>
                        <div className="text-xs text-slate-300 space-y-0.5 pt-1">
                          <div className="flex justify-between"><span>Assets Scanned:</span> <span className="font-bold text-white">{cronHistory.totals.forex?.assetsScanned ?? 0}</span></div>
                          <div className="flex justify-between"><span>Evaluated:</span> <span className="font-bold text-white">{cronHistory.totals.forex?.candidatesEvaluated ?? 0}</span></div>
                          <div className="flex justify-between"><span>Signals Found:</span> <span className="font-bold text-blue-400">{cronHistory.totals.forex?.signalsFound ?? 0}</span></div>
                          <div className="flex justify-between"><span>Accepted:</span> <span className="font-bold text-emerald-400">{cronHistory.totals.forex?.signalsAccepted ?? 0}</span></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-blue-400 uppercase font-bold">
                          <span>STOCKS 24H TOTALS</span>
                          <LineChart className="w-3.5 h-3.5" />
                        </div>
                        <div className="text-xs text-slate-300 space-y-0.5 pt-1">
                          <div className="flex justify-between"><span>Assets Scanned:</span> <span className="font-bold text-white">{cronHistory.totals.stocks?.assetsScanned ?? 0}</span></div>
                          <div className="flex justify-between"><span>Evaluated:</span> <span className="font-bold text-white">{cronHistory.totals.stocks?.candidatesEvaluated ?? 0}</span></div>
                          <div className="flex justify-between"><span>Signals Found:</span> <span className="font-bold text-blue-400">{cronHistory.totals.stocks?.signalsFound ?? 0}</span></div>
                          <div className="flex justify-between"><span>Accepted:</span> <span className="font-bold text-emerald-400">{cronHistory.totals.stocks?.signalsAccepted ?? 0}</span></div>
                        </div>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-purple-400 uppercase font-bold">
                          <span>OVERALL 24H TOTALS</span>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </div>
                        <div className="text-xs text-slate-300 space-y-0.5 pt-1">
                          <div className="flex justify-between"><span>Scans Completed:</span> <span className="font-bold text-purple-400">{cronHistory.totalScansCompleted}</span></div>
                          <div className="flex justify-between"><span>Total Scanned:</span> <span className="font-bold text-white">{cronHistory.totals.overall?.assetsScanned ?? 0}</span></div>
                          <div className="flex justify-between"><span>Total Found:</span> <span className="font-bold text-blue-400">{cronHistory.totals.overall?.signalsFound ?? 0}</span></div>
                          <div className="flex justify-between"><span>Total Accepted:</span> <span className="font-bold text-emerald-400">{cronHistory.totals.overall?.signalsAccepted ?? 0}</span></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800 text-center text-slate-400 text-xs">
                      Awaiting cron telemetry
                    </div>
                  )}

                  {/* Log List of 24-Hour Cron Scan Records */}
                  <div className="space-y-2 pt-2">
                    <span className="text-[10px] uppercase text-slate-500 font-bold block">
                      Chronological Scan Log ({cronHistory?.records?.length ?? 0} executions in 24h)
                    </span>

                    {cronHistory?.records && cronHistory.records.length > 0 ? (
                      <div className="space-y-2 max-h-80 overflow-y-auto pr-1 text-xs">
                        {cronHistory.records.map((rec: any) => {
                          const isExpanded = expandedScanId === rec.id;
                          return (
                            <div key={rec.id} className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
                              <div
                                className="flex items-center justify-between cursor-pointer select-none"
                                onClick={() => setExpandedScanId(isExpanded ? null : rec.id)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                  <span className="font-bold text-slate-200">
                                    {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </span>
                                  <span className="text-[10px] text-slate-500">
                                    ({new Date(rec.timestamp).toLocaleDateString()})
                                  </span>
                                </div>

                                <div className="flex items-center gap-3 text-[11px]">
                                  <span className="text-slate-400">Duration: {(rec.scanDurationMs / 1000).toFixed(1)}s</span>
                                  <span className="text-blue-400 font-medium">Found: {rec.totalSignalsFound}</span>
                                  <span className="text-emerald-400 font-bold">Accepted: {rec.totalSignalsAccepted}</span>
                                  {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="pt-2 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
                                  {/* Crypto details */}
                                  <div className="bg-slate-950 p-2 rounded border border-slate-800 space-y-1">
                                    <span className="text-amber-400 font-bold block">CRYPTO</span>
                                    <div>Scanned: {rec.crypto?.assetsScanned ?? 0} | Evaluated: {rec.crypto?.candidatesEvaluated ?? 0}</div>
                                    <div>Found: {rec.crypto?.signalsFound ?? 0} | Accepted: {rec.crypto?.signalsAccepted ?? 0} | Rejected: {rec.crypto?.rejected ?? 0}</div>
                                  </div>

                                  {/* Forex details */}
                                  <div className="bg-slate-950 p-2 rounded border border-slate-800 space-y-1">
                                    <span className="text-emerald-400 font-bold block">FOREX</span>
                                    <div>Scanned: {rec.forex?.assetsScanned ?? 0} | Evaluated: {rec.forex?.candidatesEvaluated ?? 0}</div>
                                    <div>Found: {rec.forex?.signalsFound ?? 0} | Accepted: {rec.forex?.signalsAccepted ?? 0} | Rejected: {rec.forex?.rejected ?? 0}</div>
                                  </div>

                                  {/* Stocks details */}
                                  <div className="bg-slate-950 p-2 rounded border border-slate-800 space-y-1">
                                    <span className="text-blue-400 font-bold block">STOCKS</span>
                                    <div>Scanned: {rec.stocks?.assetsScanned ?? 0} | Evaluated: {rec.stocks?.candidatesEvaluated ?? 0}</div>
                                    <div>Found: {rec.stocks?.signalsFound ?? 0} | Accepted: {rec.stocks?.signalsAccepted ?? 0} | Rejected: {rec.stocks?.rejected ?? 0}</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 text-center text-xs">
                        Awaiting cron telemetry
                      </div>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
