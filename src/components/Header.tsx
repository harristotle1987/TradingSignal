/**
 * Main Application Header & Tab Navigation
 * Fixed/sticky navbar providing navigation between SIGNALS and SETTINGS tabs.
 */

import { NavigationTab, HealthResponse } from '../types/index.js';
import { StatusBadge } from './StatusBadge.js';
import { Radio, Settings, ShieldCheck, RefreshCw, Lock, LogOut, UserCheck, User } from 'lucide-react';
import appLogo from '../assets/images/app_logo_icon_1786903027875.jpg';

interface HeaderProps {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  health: HealthResponse | null;
  loadingHealth: boolean;
  onRefreshHealth: () => void;
  authUser: { uid: string; email: string; admin: boolean; role?: 'ADMIN' | 'USER' } | null;
  onOpenLoginModal: () => void;
  onLogout: () => void;
}

export function Header({
  activeTab,
  setActiveTab,
  health,
  loadingHealth,
  onRefreshHealth,
  authUser,
  onOpenLoginModal,
  onLogout,
}: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 text-slate-100 border-b border-slate-800/90 pt-[env(safe-area-inset-top)] w-full max-w-full overflow-x-hidden backdrop-blur-md shadow-md shadow-black/30">
      <div className="max-w-7xl mx-auto px-3 xs:px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2">
          {/* Logo & App Name */}
          <div className="flex items-center gap-2 xs:gap-3 min-w-0 shrink">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg overflow-hidden border border-slate-800/80 bg-slate-950 flex items-center justify-center shadow-md shrink-0">
              <img
                src={appLogo}
                alt="Trading Signal System Logo"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="min-w-0 truncate">
              <div className="flex items-center gap-1.5 xs:gap-2">
                <h1 className="text-xs sm:text-base font-semibold tracking-tight text-white truncate">
                  Trading Signal AI
                </h1>
                <span className="text-[9px] sm:text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700 shrink-0 hidden xs:inline-block">
                  PWA
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block truncate">NVIDIA AI Signal Architecture</p>
            </div>
          </div>

          {/* Navigation Tabs (SIGNALS & SETTINGS) */}
          <div className="flex items-center gap-1.5 xs:gap-2 shrink-0">
            <nav className="flex items-center space-x-0.5 xs:space-x-1 bg-slate-950 p-0.5 xs:p-1 rounded-lg border border-slate-800 shrink-0">
              <button
                id="nav-tab-signals"
                onClick={() => setActiveTab('SIGNALS')}
                className={`flex items-center gap-1 xs:gap-1.5 px-2.5 xs:px-3.5 py-1.5 rounded-md text-[11px] xs:text-xs font-semibold transition-colors min-h-[36px] cursor-pointer ${
                  activeTab === 'SIGNALS'
                    ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>SIGNALS</span>
              </button>

              <button
                id="nav-tab-settings"
                onClick={() => setActiveTab('SETTINGS')}
                className={`flex items-center gap-1 xs:gap-1.5 px-2.5 xs:px-3.5 py-1.5 rounded-md text-[11px] xs:text-xs font-semibold transition-colors min-h-[36px] cursor-pointer ${
                  activeTab === 'SETTINGS'
                    ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>SETTINGS</span>
              </button>
            </nav>
          </div>

          {/* Backend Health Status Indicator & Admin Login */}
          <div className="flex items-center gap-2 sm:gap-3 text-xs">
            <div className="hidden md:flex items-center gap-2 text-slate-300 bg-slate-950 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-400 hidden sm:inline">Backend:</span>
              {health ? (
                <StatusBadge status="ok" label="Operational" />
              ) : (
                <StatusBadge status="error" label="Connecting..." />
              )}
            </div>

            {authUser ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  id="header-user-badge-btn"
                  onClick={onOpenLoginModal}
                  title={`Signed in as ${authUser.admin ? 'System Admin' : 'User'} (${authUser.email}). Click to view account details.`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-all cursor-pointer border ${
                    authUser.admin
                      ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-900/20'
                      : 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border-sky-500/40 shadow-sm shadow-sky-900/20'
                  }`}
                >
                  {authUser.admin ? <UserCheck className="w-3.5 h-3.5 text-emerald-400" /> : <User className="w-3.5 h-3.5 text-sky-400" />}
                  <span>{authUser.admin ? 'Admin' : 'User'}</span>
                  <span className="text-[10px] opacity-70 hidden lg:inline max-w-[100px] truncate">({authUser.email})</span>
                </button>

                <button
                  type="button"
                  id="header-admin-logout-btn"
                  onClick={onLogout}
                  title="Sign Out"
                  className="p-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-rose-300 rounded-lg border border-slate-800 transition cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                id="header-admin-login-btn"
                onClick={onOpenLoginModal}
                title="Sign In or Register as Admin"
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-lg text-xs transition-all shadow-md shadow-emerald-950/40 border border-emerald-400/40 transform hover:scale-105 active:scale-95 cursor-pointer font-mono tracking-wide"
              >
                <Lock className="w-3.5 h-3.5 text-emerald-100" />
                <span>Sign In / Admin</span>
              </button>
            )}

            <button
              id="header-refresh-health-btn"
              onClick={onRefreshHealth}
              disabled={loadingHealth}
              title="Refresh backend status"
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 border border-slate-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
