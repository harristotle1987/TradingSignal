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
    limit: number;
  } | null>(null);
  const [loadingScanner, setLoadingScanner] = useState<boolean>(false);
  const [triggeringScan, setTriggeringScan] = useState<boolean>(false);
  const [scannerMessage, setScannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchScannerSettings = useCallback(async () => {
    setLoadingScanner(true);
    try {
      const res = await api.getScannerSettings();
      if (res.success) {
        setScannerSettings(res.settings);
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

  const handleManualScanTrigger = async () => {
    setTriggeringScan(true);
    setScannerMessage(null);
    try {
      const res = await api.triggerScannerManualScan();
      if (res.success) {
        try {
          const freshSettings = await api.getScannerSettings();
          setScannerSettings(freshSettings.settings);
        } catch (_) {}
        setScannerMessage({
          type: 'success',
          text: `Scan Complete! Dispatched ${res.signalsFound} qualified automated setup(s).`,
        });
      }
    } catch (err: any) {
      console.error('Failed to trigger manual scan:', err);
      setScannerMessage({
        type: 'error',
        text: err?.message || 'Failed to complete scanner run.',
      });
    } finally {
      setTriggeringScan(false);
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

      {/* Automated Hourly Scanner (Gate 10) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              Automated Hourly Scanner (Server-Side)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Autonomous background scans of Crypto, Forex, and Stocks using rate-limit safe engines
            </p>
          </div>

          <div className="flex items-center gap-2">
            {scannerSettings?.enabled ? (
              <StatusBadge status="ok" label="SCANNING ACTIVE" />
            ) : (
              <StatusBadge status="unconfigured" label="DISABLED" />
            )}
          </div>
        </div>

        {scannerMessage && (
          <div className={`mb-4 p-3 rounded-lg text-xs flex items-center gap-2 ${
            scannerMessage.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            <span className="font-semibold">{scannerMessage.type === 'success' ? 'Success:' : 'Error:'}</span>
            <span>{scannerMessage.text}</span>
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Enable/Disable Scanning */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-white block">Hourly Core Scan</span>
                <p className="text-[11px] text-slate-400">
                  Allows the server to fetch prices and evaluate multi-timeframe trends autonomously.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleUpdateScanner(!scannerSettings?.enabled, scannerSettings?.notificationsEnabled ?? true)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors min-w-[90px] ${
                  scannerSettings?.enabled
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
              >
                {scannerSettings?.enabled ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>

            {/* Enable/Disable Notifications */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-white block">Background Alerts</span>
                <p className="text-[11px] text-slate-400">
                  Triggers native browser notifications automatically for background scanner findings.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleUpdateScanner(scannerSettings?.enabled ?? true, !scannerSettings?.notificationsEnabled)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors min-w-[90px] ${
                  scannerSettings?.notificationsEnabled
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
              >
                {scannerSettings?.notificationsEnabled ? 'NOTIFY ON' : 'NOTIFY OFF'}
              </button>
            </div>
          </div>

          {/* Automated Signal Interval Selection */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <label htmlFor="automated-signal-interval-select" className="text-xs font-semibold text-white block">
                Automated Signal Interval
              </label>
              <p className="text-[11px] text-slate-400">
                Minimum time elapsed between automated signal-generation evaluations. Does not force setups if market conditions fail strict confluence filters.
              </p>
            </div>

            <div className="shrink-0 min-w-[170px]">
              <select
                id="automated-signal-interval-select"
                value={scannerSettings?.intervalMinutes ?? 30}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  handleUpdateScanner(
                    scannerSettings?.enabled ?? true,
                    scannerSettings?.notificationsEnabled ?? true,
                    val
                  );
                }}
                disabled={loadingScanner}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50"
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes (1 hour)</option>
              </select>
            </div>
          </div>

          {/* Statistics and Controls */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-white block">Autonomous Scanner Schedule & Diagnostics</span>
                <p className="text-[11px] text-slate-400">
                  Continuous 24/7 background execution schedule and real-time operational status.
                </p>
              </div>

              <button
                type="button"
                onClick={handleManualScanTrigger}
                disabled={triggeringScan}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${triggeringScan ? 'animate-spin' : ''}`} />
                <span>{triggeringScan ? 'Running Scan...' : 'Trigger Now'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
              {/* 1. Scanner Status */}
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Scanner Status</span>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className={`w-2 h-2 rounded-full ${
                    scannerSettings?.scannerStatus === 'RUNNING' || triggeringScan
                      ? 'bg-amber-400 animate-ping'
                      : scannerSettings?.enabled && scannerSettings?.scannerStatus !== 'DISABLED'
                      ? 'bg-emerald-400'
                      : 'bg-slate-500'
                  }`} />
                  <span className={`font-semibold ${
                    scannerSettings?.scannerStatus === 'RUNNING' || triggeringScan
                      ? 'text-amber-400'
                      : scannerSettings?.enabled && scannerSettings?.scannerStatus !== 'DISABLED'
                      ? 'text-emerald-400'
                      : 'text-slate-400'
                  }`}>
                    {triggeringScan ? 'RUNNING' : (scannerSettings?.scannerStatus || (scannerSettings?.enabled ? 'ACTIVE' : 'DISABLED'))}
                  </span>
                </div>
              </div>

              {/* 2. Current Scan Interval */}
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Current Interval</span>
                <span className="font-semibold text-white block pt-0.5">
                  {scannerSettings?.intervalMinutes ?? 30} minutes
                </span>
              </div>

              {/* 3. Last Scan Time */}
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Last Scan Time</span>
                <span className="font-semibold text-slate-200 block pt-0.5 truncate" title={scannerSettings?.lastScanTime ? new Date(scannerSettings.lastScanTime).toLocaleString() : 'Never'}>
                  {scannerSettings?.lastScanTime ? new Date(scannerSettings.lastScanTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Never'}
                </span>
              </div>

              {/* 4. Next Scan Time */}
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 space-y-1">
                <span className="text-[10px] uppercase text-slate-500 block font-sans font-medium">Next Scan Time</span>
                <span className="font-semibold text-emerald-400 block pt-0.5 truncate" title={scannerSettings?.nextScanTime ? new Date(scannerSettings.nextScanTime).toLocaleString() : 'Scheduled'}>
                  {scannerSettings?.enabled !== false
                    ? (scannerSettings?.nextScanTime
                        ? new Date(scannerSettings.nextScanTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : 'Scheduled')
                    : 'Paused'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
