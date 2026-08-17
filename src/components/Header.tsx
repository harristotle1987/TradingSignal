/**
 * Main Application Header & Tab Navigation
 * Strictly provides navigation between SIGNALS and SETTINGS tabs.
 */

import { useState, useEffect } from 'react';
import { NavigationTab, HealthResponse } from '../types/index.js';
import { StatusBadge } from './StatusBadge.js';
import { Radio, Settings, ShieldCheck, RefreshCw, Clock } from 'lucide-react';
import { formatTimeWithZone, getLocalTimeZone } from '../utils/time.js';
import appLogo from '../assets/images/app_logo_icon_1786903027875.jpg';

interface HeaderProps {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  health: HealthResponse | null;
  loadingHealth: boolean;
  onRefreshHealth: () => void;
}

export function Header({
  activeTab,
  setActiveTab,
  health,
  loadingHealth,
  onRefreshHealth,
}: HeaderProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="bg-slate-900 text-slate-100 border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & App Name */}
          <div className="flex items-center gap-2 xs:gap-3 shrink">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg overflow-hidden border border-slate-800/80 bg-slate-950 flex items-center justify-center shadow-lg shadow-black/30 shrink-0">
              <img
                src={appLogo}
                alt="Trading Signal System Logo"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 xs:gap-2">
                <h1 className="text-xs sm:text-base font-semibold tracking-tight text-white truncate max-w-[95px] xs:max-w-[150px] sm:max-w-none">
                  Trading Signal System
                </h1>
                <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700 shrink-0 hidden xs:inline-block">
                  Gate 1
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">NVIDIA AI Signal Architecture</p>
            </div>
          </div>

          {/* Navigation Tabs (Exactly SIGNALS & SETTINGS) */}
          <nav className="flex items-center space-x-0.5 xs:space-x-1 bg-slate-950 p-0.5 xs:p-1 rounded-lg border border-slate-800 shrink-0">
            <button
              id="nav-tab-signals"
              onClick={() => setActiveTab('SIGNALS')}
              className={`flex items-center gap-1 xs:gap-2 px-2 xs:px-4 py-1.5 rounded-md text-[10px] xs:text-xs font-medium transition-colors ${
                activeTab === 'SIGNALS'
                  ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Radio className="w-3 h-3 xs:w-3.5 xs:h-3.5" />
              <span>SIGNALS</span>
            </button>

            <button
              id="nav-tab-settings"
              onClick={() => setActiveTab('SETTINGS')}
              className={`flex items-center gap-1 xs:gap-2 px-2 xs:px-4 py-1.5 rounded-md text-[10px] xs:text-xs font-medium transition-colors ${
                activeTab === 'SETTINGS'
                  ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Settings className="w-3 h-3 xs:w-3.5 xs:h-3.5" />
              <span>SETTINGS</span>
            </button>
          </nav>

          {/* Real-Time Live Clock & Multi-Timezone Status */}
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono">
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-[11px]">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <div className="flex items-center gap-3">
                <span title={`Local User Time (${getLocalTimeZone()})`}>
                  <span className="text-slate-500 mr-1">LOC:</span>
                  <span className="text-slate-200 font-semibold">{formatTimeWithZone(now, 'LOCAL')}</span>
                </span>
                <span className="text-slate-700">|</span>
                <span title="Exchange Time (Eastern Time)">
                  <span className="text-slate-500 mr-1">EXCH:</span>
                  <span className="text-emerald-400 font-semibold">{formatTimeWithZone(now, 'EXCHANGE')}</span>
                </span>
                <span className="text-slate-700">|</span>
                <span title="Universal Coordinated Time (UTC)">
                  <span className="text-slate-500 mr-1">UTC:</span>
                  <span className="text-blue-400 font-semibold">{formatTimeWithZone(now, 'UTC')}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Backend Health Status Indicator */}
          <div className="hidden md:flex items-center gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Backend:</span>
              {health ? (
                <StatusBadge status="ok" label="Operational" />
              ) : (
                <StatusBadge status="error" label="Connecting..." />
              )}
            </div>

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

        {/* Mobile Real-Time Clocks - Only visible on screens < lg */}
        <div className="lg:hidden pb-3 pt-1 flex flex-col items-center justify-center text-[10px] sm:text-xs font-mono border-t border-slate-800/40">
          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800/60 w-full text-center">
            <span className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>TIME:</span>
            </span>
            <span title={`Local User Time (${getLocalTimeZone()})`} className="whitespace-nowrap">
              <span className="text-slate-500 mr-1">LOC:</span>
              <span className="text-slate-200 font-semibold">{formatTimeWithZone(now, 'LOCAL')}</span>
            </span>
            <span className="text-slate-800 hidden xs:inline">|</span>
            <span title="Exchange Time (Eastern Time)" className="whitespace-nowrap">
              <span className="text-slate-500 mr-1">EXCH:</span>
              <span className="text-emerald-400 font-semibold">{formatTimeWithZone(now, 'EXCHANGE')}</span>
            </span>
            <span className="text-slate-800 hidden xs:inline">|</span>
            <span title="Universal Coordinated Time (UTC)" className="whitespace-nowrap">
              <span className="text-slate-500 mr-1">UTC:</span>
              <span className="text-blue-400 font-semibold">{formatTimeWithZone(now, 'UTC')}</span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
