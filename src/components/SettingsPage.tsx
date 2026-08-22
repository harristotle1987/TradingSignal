/**
 * SETTINGS Page Component (Gate 1 Foundation)
 *
 * CRITICAL SECURITY REQUIREMENT:
 * Sensitive API keys are read strictly from server environment variables.
 * They are NEVER stored in localStorage or exposed in frontend JavaScript.
 */

import { useState, useEffect, useCallback } from 'react';
import { ConfigStatusResponse, MarketStatusResponse } from '../types/index.js';
import { api } from '../api/client.js';
import { StatusBadge } from './StatusBadge.js';
import { MarketDiagnostics } from './MarketDiagnostics.js';
import { NotificationService, NotificationPermissionStatus } from '../utils/notification.js';
import {
  ShieldCheck,
  Cpu,
  Database,
  RefreshCw,
  KeyRound,
  Server,
  AlertTriangle,
  Activity,
  Bell,
  BellRing,
  Volume2,
  VolumeX,
  CheckCircle2,
  Clock,
} from 'lucide-react';

interface SettingsPageProps {
  configStatus: ConfigStatusResponse | null;
  loadingConfig: boolean;
  onRefreshConfig: () => void;
}

export function SettingsPage({
  configStatus,
  loadingConfig,
  onRefreshConfig,
}: SettingsPageProps) {
  const [marketStatus, setMarketStatus] = useState<MarketStatusResponse | null>(null);
  const [loadingMarketStatus, setLoadingMarketStatus] = useState<boolean>(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionStatus>(
    NotificationService.getPermission()
  );
  const [isPushSubscribed, setIsPushSubscribed] = useState<boolean>(false);
  const [pushStatusLoading, setPushStatusLoading] = useState<boolean>(false);
  const [pushActionMessage, setPushActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [subscriberCount, setSubscriberCount] = useState<number>(0);
  const [soundAlerts, setSoundAlerts] = useState<boolean>(true);
  const [highPriorityPushEnabled, setHighPriorityPushEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('high_priority_push_enabled') !== 'false';
    } catch {
      return true;
    }
  });
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

  const [frequencyConfig, setFrequencyConfig] = useState<{
    dailySignalCap: number;
    preset: '5' | '10' | '15' | 'CUSTOM';
  } | null>(null);
  const [customCapInput, setCustomCapInput] = useState<number>(5);

  const fetchFrequencyConfig = useCallback(async () => {
    try {
      const res = await api.getFrequencyConfig();
      if (res.success && res.data) {
        setFrequencyConfig({
          dailySignalCap: res.data.dailySignalCap,
          preset: res.data.preset,
        });
        setCustomCapInput(res.data.dailySignalCap);
      }
    } catch (err) {
      console.error('Failed to fetch frequency config:', err);
    }
  }, []);

  const handleUpdateFrequency = async (preset: '5' | '10' | '15' | 'CUSTOM', customCap?: number) => {
    try {
      const res = await api.updateFrequencyConfig({
        preset,
        customCap,
      });
      if (res.success && res.data) {
        setFrequencyConfig({
          dailySignalCap: res.data.dailySignalCap,
          preset: res.data.preset,
        });
        await fetchScannerSettings();
        setScannerMessage({ type: 'success', text: res.message });
        setTimeout(() => setScannerMessage(null), 4000);
      }
    } catch (err) {
      console.error('Failed to update frequency config:', err);
      setScannerMessage({ type: 'error', text: 'Failed to update daily cap.' });
      setTimeout(() => setScannerMessage(null), 4000);
    }
  };

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
    } catch (err) {
      console.error('Failed to update scanner settings:', err);
      setScannerMessage({ type: 'error', text: 'Failed to update scanner settings.' });
      setTimeout(() => setScannerMessage(null), 4000);
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

  const checkPushSubscription = useCallback(async () => {
    try {
      const sub = await NotificationService.getExistingPushSubscription();
      setIsPushSubscribed(Boolean(sub));
      setNotificationPermission(NotificationService.getPermission());

      const status = await api.getPushStatus();
      if (status.success) {
        setSubscriberCount(status.subscriberCount);
      }
    } catch (e) {
      console.warn('Could not check push status:', e);
    }
  }, []);

  const handleSubscribePush = async () => {
    setPushStatusLoading(true);
    setPushActionMessage(null);
    try {
      const result = await NotificationService.subscribeToPushNotifications();
      setNotificationPermission(result.status);
      if (result.success) {
        setIsPushSubscribed(true);
        setPushActionMessage({ type: 'success', text: result.message || 'Push notifications subscribed!' });
        await checkPushSubscription();
      } else {
        setPushActionMessage({ type: 'error', text: result.message || 'Subscription failed.' });
      }
    } catch (err: any) {
      setPushActionMessage({ type: 'error', text: err?.message || 'Push subscription error' });
    } finally {
      setPushStatusLoading(false);
      setTimeout(() => setPushActionMessage(null), 5000);
    }
  };

  const handleUnsubscribePush = async () => {
    setPushStatusLoading(true);
    setPushActionMessage(null);
    try {
      const result = await NotificationService.unsubscribeFromPushNotifications();
      if (result.success) {
        setIsPushSubscribed(false);
        setPushActionMessage({ type: 'success', text: 'Push notifications disabled on this device.' });
        await checkPushSubscription();
      } else {
        setPushActionMessage({ type: 'error', text: result.message });
      }
    } catch (err: any) {
      setPushActionMessage({ type: 'error', text: err?.message || 'Unsubscribe error' });
    } finally {
      setPushStatusLoading(false);
      setTimeout(() => setPushActionMessage(null), 5000);
    }
  };

  const handleTestAlert = async () => {
    setPushActionMessage(null);
    try {
      const success = await NotificationService.sendTestAlert();
      if (success) {
        setPushActionMessage({ type: 'success', text: 'Test alert triggered successfully!' });
      } else {
        setPushActionMessage({ type: 'error', text: 'Failed to send test alert. Please check permissions.' });
      }
    } catch (err: any) {
      setPushActionMessage({ type: 'error', text: err?.message || 'Test alert failed' });
    }
    setTimeout(() => setPushActionMessage(null), 4000);
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
    checkPushSubscription();
    fetchFrequencyConfig();
  }, [fetchMarketStatus, fetchScannerSettings, checkPushSubscription, fetchFrequencyConfig]);

  const envProviders = configStatus?.providers;
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
              Server-Side Credential Isolation Standard
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              All credentials (including the <strong>NVIDIA API Key</strong> and market provider keys) are managed strictly on the backend through environment variables. Credentials are <strong>never stored in localStorage or exposed in frontend code</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Provider Connectivity & Live Health Tests */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Real Market Provider Connectivity Status
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Verified via actual server-side API requests to external market providers (Gate 2)
            </p>
          </div>

          <button
            id="settings-refresh-market-status-btn"
            onClick={fetchMarketStatus}
            disabled={loadingMarketStatus}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMarketStatus ? 'animate-spin' : ''}`} />
            <span>Ping Provider APIs</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Bitget */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Bitget Market Feed</span>
              {getProviderConnectionBadge('bitget')}
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Type: Spot Crypto &bull; Endpoint: api.bitget.com
            </p>
            {activeMarketProviders?.bitget?.latencyMs !== undefined && (
              <p className="text-[10px] text-emerald-400 font-mono">
                Latency: {activeMarketProviders.bitget.latencyMs}ms
              </p>
            )}
          </div>

          {/* Finnhub */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Finnhub Market Feed</span>
              {getProviderConnectionBadge('finnhub')}
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Type: Stocks & Forex &bull; Key: FINNHUB_API_KEY
            </p>
            {activeMarketProviders?.finnhub?.errorMessage && (
              <p className="text-[10px] text-amber-400 font-mono">
                {activeMarketProviders.finnhub.errorMessage}
              </p>
            )}
          </div>

          {/* Twelve Data (Forex) */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Twelve Data (Forex)</span>
              {getProviderConnectionBadge('twelvedata')}
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Type: Authoritative Forex &bull; Key: TWELVE_DATA_API_KEY
            </p>
            {activeMarketProviders?.twelvedata?.errorMessage && (
              <p className="text-[10px] text-amber-400 font-mono">
                {activeMarketProviders.twelvedata.errorMessage}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Live Market Diagnostics Component */}
      <MarketDiagnostics />

      {/* Main Provider Configuration Status Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-400" />
              Server Environment Variables
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Backend environment variable presence verification
            </p>
          </div>

          <button
            id="settings-refresh-config-btn"
            onClick={onRefreshConfig}
            disabled={loadingConfig}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingConfig ? 'animate-spin' : ''}`} />
            <span>Refresh Env Check</span>
          </button>
        </div>

        <div className="space-y-4">
          {/* AI Provider: NVIDIA API */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-emerald-400">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">NVIDIA AI API Provider</h4>
                  <p className="text-[11px] text-slate-400 font-mono">Environment Variable: NVIDIA_API_KEY</p>
                </div>
              </div>

              {envProviders?.nvidia?.configured ? (
                <StatusBadge status="configured" label="Configured" />
              ) : (
                <StatusBadge status="unconfigured" label="Key Missing" />
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
              <span>Security Policy: Server-Side Proxied Execution</span>
              {!envProviders?.nvidia?.configured && (
                <span className="text-amber-400 flex items-center gap-1 font-mono">
                  <AlertTriangle className="w-3 h-3" /> Set NVIDIA_API_KEY in server environment
                </span>
              )}
            </div>
          </div>

          {/* Bitget Env */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-300">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">Bitget Market Provider</h4>
                  <p className="text-[11px] text-slate-400 font-mono">
                    BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE
                  </p>
                </div>
              </div>

              {envProviders?.bitget?.configured ? (
                <StatusBadge status="configured" label="Configured" />
              ) : (
                <StatusBadge status="unconfigured" label="Not Set" />
              )}
            </div>
          </div>

          {/* Finnhub Env */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-300">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">Finnhub Market Data</h4>
                  <p className="text-[11px] text-slate-400 font-mono">Environment Variable: FINNHUB_API_KEY</p>
                </div>
              </div>

              {envProviders?.finnhub?.configured ? (
                <StatusBadge status="configured" label="Configured" />
              ) : (
                <StatusBadge status="unconfigured" label="Not Set" />
              )}
            </div>
          </div>

          {/* Twelve Data Env */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-300">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">Twelve Data (Forex)</h4>
                  <p className="text-[11px] text-slate-400 font-mono">Environment Variable: TWELVE_DATA_API_KEY</p>
                </div>
              </div>

              {envProviders?.twelvedata?.configured ? (
                <StatusBadge status="configured" label="Configured" />
              ) : (
                <StatusBadge status="unconfigured" label="Not Set" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Real-Time Browser & Web Push PWA Notifications */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <BellRing className="w-4 h-4 text-emerald-400" />
              PWA Push Notifications & Audio Alerts
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Instant background push notifications for verified Gate 9 TOP TRADEs (even when the app is closed)
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isPushSubscribed ? (
              <StatusBadge status="ok" label="PUSH SUBSCRIBED" />
            ) : notificationPermission === 'granted' ? (
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
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white block">Service Worker Web Push Subscription</span>
                {subscriberCount > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-slate-900 border border-slate-700 text-slate-300 rounded">
                    {subscriberCount} active device{subscriberCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">
                Uses W3C standard Push API with cryptographically signed VAPID envelopes. Only genuinely qualifying actionable signals (passed all hard gates and minimum R:R) are notified.
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
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono transition-colors"
              >
                Test Push
              </button>

              {isPushSubscribed ? (
                <button
                  type="button"
                  disabled={pushStatusLoading}
                  onClick={handleUnsubscribePush}
                  className="px-3.5 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/50 border border-red-800/50 text-red-300 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {pushStatusLoading ? 'Updating...' : 'Disable Push'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pushStatusLoading}
                  onClick={handleSubscribePush}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>{pushStatusLoading ? 'Connecting...' : 'Enable PWA Push Alerts'}</span>
                </button>
              )}
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

            {/* High-Priority Real-Time Push Notifications Toggle */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between gap-4 md:col-span-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white block">High-Priority Trading Signals Push Alerts</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-500/40 rounded font-bold">
                    PRIORITY PUSH
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Enables instant real-time push notifications delivered via Web Push service specifically for high-priority trading signals (Top Trades / Actionable Signals).
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  const nextVal = !highPriorityPushEnabled;
                  setHighPriorityPushEnabled(nextVal);
                  try {
                    localStorage.setItem('high_priority_push_enabled', String(nextVal));
                  } catch {}
                  setScannerMessage({
                    type: 'success',
                    text: nextVal ? 'High-priority push alerts enabled.' : 'High-priority push alerts muted.',
                  });
                  setTimeout(() => setScannerMessage(null), 3000);
                }}
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors min-w-[100px] shrink-0 ${
                  highPriorityPushEnabled
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
              >
                {highPriorityPushEnabled ? 'PUSH ACTIVE' : 'PUSH MUTED'}
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

          {/* Daily Automated Signal Cap Configuration (Gate 36 / 53) */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-white block">
                Daily Signal Cap Preset
              </span>
              <p className="text-[11px] text-slate-400">
                Choose the maximum allowed automated trading signals generated per UTC day. Default is 5.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="min-w-[120px]">
                <select
                  id="daily-signal-cap-preset-select"
                  value={frequencyConfig?.preset || '5'}
                  onChange={(e) => {
                    const preset = e.target.value as '5' | '10' | '15' | 'CUSTOM';
                    if (preset !== 'CUSTOM') {
                      handleUpdateFrequency(preset);
                    } else {
                      handleUpdateFrequency('CUSTOM', customCapInput);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="5">5 Signals (Default)</option>
                  <option value="10">10 Signals</option>
                  <option value="15">15 Signals</option>
                  <option value="CUSTOM">Custom Cap</option>
                </select>
              </div>

              {frequencyConfig?.preset === 'CUSTOM' && (
                <div className="flex items-center gap-1.5 max-w-[150px]">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={customCapInput}
                    onChange={(e) => setCustomCapInput(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-16 bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1.5 text-xs font-mono text-white text-center focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleUpdateFrequency('CUSTOM', customCapInput)}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                  >
                    Set
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Statistics and Controls */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">Daily Automated Signal Cap</span>
                  <span className="text-[11px] font-mono text-slate-400">
                    ({scannerSettings?.signalsSentTimestamps?.length ?? 0} / {scannerSettings?.limit ?? 5} today)
                  </span>
                </div>
                
                {/* Custom Progress Bar */}
                <div className="w-48 h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (((scannerSettings?.signalsSentTimestamps?.length ?? 0) / (scannerSettings?.limit ?? 5)) * 100))}%`
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Strict safety ceiling limit to prevent over-trading. Maximum automated signals per UTC day.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleManualScanTrigger}
                  disabled={triggeringScan || loadingScanner}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${triggeringScan ? 'animate-spin' : ''}`} />
                  <span>{triggeringScan ? 'RUNNING SWEEP...' : 'TRIGGER MANUAL SWEEP'}</span>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/60 flex flex-wrap gap-4 text-[10px] text-slate-400 font-mono">
              <div>
                <span>Last Scan: </span>
                <span className="text-slate-200">
                  {scannerSettings?.lastScanTime && scannerSettings.lastScanTime > 0
                    ? new Date(scannerSettings.lastScanTime).toLocaleString()
                    : 'Never'}
                </span>
              </div>
              <div className="hidden sm:block text-slate-600">|</div>
              <div>
                <span>Next Automated Run: </span>
                <span className="text-emerald-400">
                  {scannerSettings?.lastScanTime && scannerSettings.lastScanTime > 0
                    ? new Date(
                        scannerSettings.lastScanTime + (scannerSettings.intervalMinutes ?? 30) * 60 * 1000
                      ).toLocaleString()
                    : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Backend Diagnostics Overview */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Server className="w-4 h-4 text-emerald-400" />
          Server System Overview
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <span className="text-slate-400 text-[10px] block">ENVIRONMENT</span>
            <span className="text-slate-200 uppercase font-semibold">{configStatus?.environment || 'Development'}</span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <span className="text-slate-400 text-[10px] block">PORT BINDING</span>
            <span className="text-slate-200 font-semibold">0.0.0.0:3000</span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <span className="text-slate-400 text-[10px] block">MARKET ROUTER</span>
            <span className="text-emerald-400 font-semibold">GET /api/market/*</span>
          </div>
        </div>
      </div>
    </div>
  );
}

