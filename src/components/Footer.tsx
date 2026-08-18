/**
 * Main Application Footer
 * Houses the real-time digital clock (Local, Exchange, UTC) and system metadata.
 */

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { formatTimeWithZone, getLocalTimeZone } from '../utils/time.js';

export function Footer() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <footer className="border-t border-slate-900 bg-slate-950 py-5 sm:py-6 text-slate-400 text-xs text-center pb-[max(1.25rem,env(safe-area-inset-bottom))] w-full">
      <div className="max-w-7xl mx-auto px-3 xs:px-4 sm:px-6 lg:px-8 flex flex-col gap-4 items-center justify-between">
        
        {/* Real-Time Digital Clock Section */}
        <div className="w-full flex justify-center">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-slate-900/80 px-3.5 py-2 rounded-xl border border-slate-800/80 text-xs font-mono shadow-inner max-w-2xl w-full text-center">
            <div className="flex items-center gap-1.5 text-slate-400 shrink-0">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Time:</span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] sm:text-xs">
              <span title={`Local User Time (${getLocalTimeZone()})`} className="whitespace-nowrap">
                <span className="text-slate-500 mr-1">LOC:</span>
                <span className="text-slate-200 font-semibold">{formatTimeWithZone(now, 'LOCAL')}</span>
              </span>

              <span className="text-slate-800 hidden xs:inline">•</span>

              <span title="Exchange Time (Eastern Time)" className="whitespace-nowrap">
                <span className="text-slate-500 mr-1">EXCH:</span>
                <span className="text-emerald-400 font-semibold">{formatTimeWithZone(now, 'EXCHANGE')}</span>
              </span>

              <span className="text-slate-800 hidden xs:inline">•</span>

              <span title="Universal Coordinated Time (UTC)" className="whitespace-nowrap">
                <span className="text-slate-500 mr-1">UTC:</span>
                <span className="text-blue-400 font-semibold">{formatTimeWithZone(now, 'UTC')}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Footer Brand & System Info */}
        <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3 text-slate-400 pt-1">
          <p className="font-mono text-[10px] sm:text-[11px] text-slate-400">
            Trading Signal AI &bull; Production PWA
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-[10px] sm:text-[11px] font-mono text-slate-500">
            <span>Server: 0.0.0.0:3000</span>
            <span className="hidden xs:inline">&bull;</span>
            <span>NVIDIA AI Architecture</span>
          </div>
        </div>

      </div>
    </footer>
  );
}
