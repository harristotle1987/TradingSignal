/**
 * Main Application Header & Tab Navigation
 * Strictly provides navigation between SIGNALS and SETTINGS tabs.
 */

import { useState, useEffect } from 'react';
import { NavigationTab, HealthResponse } from '../types/index.js';
import { StatusBadge } from './StatusBadge.js';
import { Activity, Radio, Settings, ShieldCheck, RefreshCw, Clock, Globe } from 'lucide-react';
import { formatTimeWithZone, getLocalTimeZone } from '../utils/time.js';

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
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-white">
                  Trading Signal System
                </h1>
                <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
                  Gate 1
                </span>
              </div>
              <p className="text-xs text-slate-400">NVIDIA AI Signal Architecture</p>
            </div>
          </div>

          {/* Navigation Tabs (Exactly SIGNALS & SETTINGS) */}
          <nav className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              id="nav-tab-signals"
              onClick={() => setActiveTab('SIGNALS')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
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
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'SETTINGS'
                  ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
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
      </div>
    </header>
  );
}
