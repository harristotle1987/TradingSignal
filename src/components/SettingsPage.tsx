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
  const [loadingScanner, setLoadingScanner] = useState<boolean>(false);
  const [scannerMessage, setScannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchScannerSettings = useCallback(async () => {
    setLoadingScanner(true);
    try {
      const res = await api.getScannerSettings();
      if (res.success) {
        setScannerSettings(res.settings);
        if (res.cronJobOrg) {
          setCronJobOrg(res.cronJobOrg);
        }
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
          {/* Main Display Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Scheduler */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
              <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Scheduler</span>
              <div className="flex items-center gap-2 pt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="font-semibold text-slate-100 text-sm">cron-job.org</span>
              </div>
            </div>

            {/* Status */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
              <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Status</span>
              <div className="flex items-center gap-2 pt-0.5">
                <span className={`w-2 h-2 rounded-full ${
                  scannerSettings?.scannerStatus === 'RUNNING'
                    ? 'bg-amber-400 animate-ping'
                    : cronJobOrg?.statusText === 'ACTIVE' || scannerSettings?.enabled !== false
                    ? 'bg-emerald-400'
                    : 'bg-slate-500'
                }`} />
                <span className={`font-semibold text-sm ${
                  scannerSettings?.scannerStatus === 'RUNNING'
                    ? 'text-amber-400'
                    : cronJobOrg?.statusText === 'ACTIVE' || scannerSettings?.enabled !== false
                    ? 'text-emerald-400'
                    : 'text-slate-400'
                }`}>
                  {scannerSettings?.scannerStatus || cronJobOrg?.statusText || (scannerSettings?.enabled !== false ? 'ACTIVE' : 'DISABLED')}
                </span>
              </div>
            </div>

            {/* Schedule */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
              <span className="text-[10px] uppercase block font-sans font-semibold text-slate-400">EXTERNAL CRON SCHEDULE</span>
              <div className="text-[10px] text-amber-400 font-sans font-medium">Read-only • Managed by cron-job.org</div>
              <span className="font-semibold text-white block pt-1 text-xs truncate" title={cronJobOrg?.schedule?.intervalDescription || `Schedule: Every ${scannerSettings?.intervalMinutes ?? 15} minutes`}>
                {cronJobOrg?.schedule?.intervalDescription || `Schedule: Every ${scannerSettings?.intervalMinutes ?? 15} minutes`}
              </span>
            </div>

            {/* Last Execution */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
              <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium font-semibold text-slate-400">Last Execution</span>
              <span className="font-semibold text-slate-200 block pt-0.5 truncate text-xs" title={
                cronJobOrg?.lastExecution?.timestamp && cronJobOrg.lastExecution.timestamp > 0
                  ? new Date(cronJobOrg.lastExecution.timestamp).toLocaleString()
                  : scannerSettings?.lastCronExecution && scannerSettings.lastCronExecution > 0
                  ? new Date(scannerSettings.lastCronExecution).toLocaleString()
                  : 'Never'
              }>
                {cronJobOrg?.lastExecution?.timestamp && cronJobOrg.lastExecution.timestamp > 0
                  ? new Date(cronJobOrg.lastExecution.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : scannerSettings?.lastCronExecution && scannerSettings.lastCronExecution > 0
                  ? new Date(scannerSettings.lastCronExecution).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : 'Never'}
              </span>
            </div>

            {/* Next Execution */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
              <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium font-semibold text-slate-400">Next Execution</span>
              <span className="font-semibold text-emerald-400 block pt-0.5 truncate text-xs" title={
                cronJobOrg?.nextExecution?.timestamp && cronJobOrg.nextExecution.timestamp > 0
                  ? new Date(cronJobOrg.nextExecution.timestamp).toLocaleString()
                  : scannerSettings?.nextCronExecution && scannerSettings.nextCronExecution > 0
                  ? new Date(scannerSettings.nextCronExecution).toLocaleString()
                  : 'Scheduled'
              }>
                {cronJobOrg?.nextExecution?.timestamp && cronJobOrg.nextExecution.timestamp > 0
                  ? new Date(cronJobOrg.nextExecution.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : scannerSettings?.nextCronExecution && scannerSettings.nextCronExecution > 0
                  ? new Date(scannerSettings.nextCronExecution).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : 'Scheduled'}
              </span>
            </div>
          </div>

          {/* Last Scan Telemetry Panel */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
                Last Scan Telemetry
              </span>
              <span className="text-[11px] text-slate-400">
                {scannerSettings?.lastAutomatedScan && scannerSettings.lastAutomatedScan > 0
                  ? `Completed: ${new Date(scannerSettings.lastAutomatedScan).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}${scannerSettings.lastScanDuration ? ` • ${(scannerSettings.lastScanDuration / 1000).toFixed(1)}s` : ''}`
                  : scannerSettings?.lastScanTime && scannerSettings.lastScanTime > 0
                  ? `Completed: ${new Date(scannerSettings.lastScanTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                  : 'No automated scan completed yet'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-sans block font-medium">Candidates Evaluated</span>
                <span className="text-sm font-bold text-slate-200 block">
                  {scannerSettings?.lastCandidatesEvaluated ?? 0}
                </span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-sans block font-medium">Signals Found</span>
                <span className="text-sm font-bold text-blue-400 block">
                  {scannerSettings?.lastSignalsFound ?? 0}
                </span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-sans block font-medium">Accepted Signals</span>
                <span className="text-sm font-bold text-emerald-400 block">
                  {scannerSettings?.lastAcceptedSignals ?? 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
