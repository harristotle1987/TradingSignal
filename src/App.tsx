/**
 * Main Application Component
 * Manages active tab state (SIGNALS vs SETTINGS) and fetches backend status.
 */

import { useState, useEffect, useCallback } from 'react';
import { NavigationTab, HealthResponse, ConfigStatusResponse } from './types/index.js';
import { api } from './api/client.js';
import { Header } from './components/Header.js';
import { PwaInstallBanner } from './components/PwaInstallBanner.js';
import { SignalsPage } from './components/SignalsPage.js';
import { SettingsPage } from './components/SettingsPage.js';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavigationTab>('SIGNALS');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [configStatus, setConfigStatus] = useState<ConfigStatusResponse | null>(null);

  const [loadingHealth, setLoadingHealth] = useState<boolean>(true);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const data = await api.getHealth();
      setHealth(data);
      setError(null);
    } catch (err) {
      console.warn('[App] Backend health check retry pending:', err instanceof Error ? err.message : String(err));
      setError('Connecting to backend API services...');
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  const fetchConfigStatus = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const data = await api.getConfigStatus();
      setConfigStatus(data);
    } catch (err) {
      console.warn('[App] Backend config check retry pending:', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchConfigStatus();
  }, [fetchHealth, fetchConfigStatus]);

  return (
    <div className="min-h-screen min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-emerald-500/20 selection:text-emerald-200">
      {/* Header with Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        health={health}
        loadingHealth={loadingHealth}
        onRefreshHealth={fetchHealth}
      />

      {/* Compact PWA Install Prompt */}
      <PwaInstallBanner />

      {/* Backend Disconnection Error Banner */}
      {error && (
        <div className="bg-amber-950/80 border-b border-amber-800/80 text-amber-200 text-xs px-3 sm:px-4 py-2.5 sm:py-3 w-full">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate text-[11px] sm:text-xs">{error}</span>
            </div>
            <button
              onClick={fetchHealth}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-900/60 hover:bg-amber-800 text-amber-100 rounded-md border border-amber-700/50 transition-colors text-xs shrink-0 cursor-pointer min-h-[36px]"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 xs:px-4 sm:px-6 lg:px-8 py-4 sm:py-8 overflow-x-hidden min-w-0">
        {activeTab === 'SIGNALS' ? (
          <SignalsPage health={health} />
        ) : (
          <SettingsPage
            configStatus={configStatus}
            loadingConfig={loadingConfig}
            onRefreshConfig={fetchConfigStatus}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-5 sm:py-6 text-slate-400 text-xs text-center pb-[max(1.25rem,env(safe-area-inset-bottom))] w-full">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3">
          <p className="font-mono text-[10px] sm:text-[11px] text-slate-400">
            Trading Signal AI &bull; Production PWA
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-[10px] sm:text-[11px] font-mono text-slate-500">
            <span>Server: 0.0.0.0:3000</span>
            <span className="hidden xs:inline">&bull;</span>
            <span>NVIDIA AI Architecture</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
