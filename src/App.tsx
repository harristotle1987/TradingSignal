/**
 * Main Application Component
 * Manages active tab state (SIGNALS vs SETTINGS) and fetches backend status.
 */

import { useState, useEffect, useCallback } from 'react';
import { NavigationTab, HealthResponse } from './types/index.js';
import { api, AuthUser } from './api/client.js';
import { Header } from './components/Header.js';
import { Footer } from './components/Footer.js';
import { PwaInstallBanner } from './components/PwaInstallBanner.js';
import { SignalsPage } from './components/SignalsPage.js';
import { SettingsPage } from './components/SettingsPage.js';
import { LoginModal } from './components/LoginModal.js';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavigationTab>('SIGNALS');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState<boolean>(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => api.getStoredUser());

  const [loadingHealth, setLoadingHealth] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const res = await api.getAuthMe();
      if (res.authenticated && res.user) {
        setAuthUser(res.user);
      } else {
        setAuthUser(null);
      }
    } catch {
      // If token expired or invalid, auth state was already cleared
      setAuthUser(api.getStoredUser());
    }
  }, []);

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

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAuthUser(null);
      fetchHealth();
    }
  }, [fetchHealth]);

  useEffect(() => {
    const unsubUnauth = api.onUnauthorized(() => {
      setAuthUser(null);
    });

    const unsubAuthChange = api.onAuthChange((user) => {
      setAuthUser(user);
    });

    fetchHealth();
    checkAuth();

    return () => {
      unsubUnauth();
      unsubAuthChange();
    };
  }, [fetchHealth, checkAuth]);

  return (
    <div className="min-h-screen min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-emerald-500/20 selection:text-emerald-200 pt-14 sm:pt-16">
      {/* Header with Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        health={health}
        loadingHealth={loadingHealth}
        onRefreshHealth={fetchHealth}
        authUser={authUser}
        onOpenLoginModal={() => setIsLoginOpen(true)}
        onLogout={handleLogout}
      />

      {/* Authentication Modal */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onLoginSuccess={(user) => {
          setAuthUser(user);
          fetchHealth();
        }}
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
          <SettingsPage />
        )}
      </main>

      {/* Footer with Digital Clock */}
      <Footer />
    </div>
  );
}
