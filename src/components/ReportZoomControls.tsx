import React, { useEffect, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
} from 'lucide-react';

export interface ReportZoomControlsProps {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onSetZoom?: (level: number) => void;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
  showPresets?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  compact?: boolean;
  label?: string;
  idPrefix?: string;
}

export const ZOOM_PRESETS = [0.8, 1.0, 1.25, 1.5, 1.75];

export function useReportZoom(initialZoom = 1.0, minZoom = 0.7, maxZoom = 2.0, step = 0.15) {
  const [zoomLevel, setZoomLevel] = React.useState<number>(initialZoom);

  const zoomIn = useCallback(() => {
    setZoomLevel((prev) => Math.min(maxZoom, Number((prev + step).toFixed(2))));
  }, [maxZoom, step]);

  const zoomOut = useCallback(() => {
    setZoomLevel((prev) => Math.max(minZoom, Number((prev - step).toFixed(2))));
  }, [minZoom, step]);

  const resetZoom = useCallback(() => {
    setZoomLevel(1.0);
  }, []);

  const setZoom = useCallback(
    (val: number) => {
      const clamped = Math.min(maxZoom, Math.max(minZoom, Number(val.toFixed(2))));
      setZoomLevel(clamped);
    },
    [minZoom, maxZoom]
  );

  return {
    zoomLevel,
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom,
    minZoom,
    maxZoom,
  };
}

export const ReportZoomControls: React.FC<ReportZoomControlsProps> = ({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onSetZoom,
  minZoom = 0.7,
  maxZoom = 2.0,
  showPresets = true,
  isFullscreen,
  onToggleFullscreen,
  compact = false,
  label = 'Zoom Report',
  idPrefix = 'report-zoom',
}) => {
  const percentage = Math.round(zoomLevel * 100);
  const isAtMin = zoomLevel <= minZoom + 0.01;
  const isAtMax = zoomLevel >= maxZoom - 0.01;
  const isDefault = Math.abs(zoomLevel - 1.0) < 0.02;

  // Keyboard shortcut handler (optional helper if focused)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only capture if target is not an input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        // Allow default browser zoom or custom if in fullscreen modal
        if (isFullscreen) {
          e.preventDefault();
          onZoomIn();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        if (isFullscreen) {
          e.preventDefault();
          onZoomOut();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        if (isFullscreen) {
          e.preventDefault();
          onResetZoom();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, onZoomIn, onZoomOut, onResetZoom]);

  return (
    <div
      id={`${idPrefix}-toolbar`}
      className="inline-flex items-center gap-1.5 bg-slate-900/90 hover:bg-slate-900 border border-slate-800 p-1 rounded-lg text-xs font-mono text-slate-300 shadow-sm transition-colors"
      role="toolbar"
      aria-label="AI Signal Report Zoom Controls"
    >
      {/* Optional Label in non-compact mode */}
      {!compact && label && (
        <span className="text-[10px] text-slate-400 font-sans font-medium px-1.5 hidden sm:inline select-none">
          {label}:
        </span>
      )}

      {/* Zoom Out Button */}
      <button
        type="button"
        id={`${idPrefix}-btn-out`}
        onClick={onZoomOut}
        disabled={isAtMin}
        className="p-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent text-slate-300 hover:text-white transition cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-emerald-500"
        title="Zoom out report (-15%)"
        aria-label="Zoom out"
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>

      {/* Zoom Percentage Display / Click to Reset */}
      <button
        type="button"
        id={`${idPrefix}-btn-display`}
        onClick={onResetZoom}
        className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition min-w-[42px] text-center cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
          isDefault
            ? 'bg-slate-950 text-emerald-400 border border-slate-800 hover:border-emerald-500/50'
            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/60'
        }`}
        title="Click to reset zoom to 100%"
        aria-label={`Current zoom is ${percentage}%. Click to reset to 100%`}
      >
        {percentage}%
      </button>

      {/* Zoom In Button */}
      <button
        type="button"
        id={`${idPrefix}-btn-in`}
        onClick={onZoomIn}
        disabled={isAtMax}
        className="p-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent text-slate-300 hover:text-white transition cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-emerald-500"
        title="Zoom in report (+15%)"
        aria-label="Zoom in"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>

      {/* Reset Icon Button (if not default) */}
      {!isDefault && (
        <button
          type="button"
          id={`${idPrefix}-btn-reset`}
          onClick={onResetZoom}
          className="p-1 rounded hover:bg-slate-800 text-amber-400 hover:text-amber-300 transition cursor-pointer"
          title="Reset zoom to 100%"
          aria-label="Reset zoom to 100%"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}

      {/* Preset Quick-Buttons (non-compact mode on desktop) */}
      {showPresets && !compact && onSetZoom && (
        <div className="hidden md:flex items-center gap-1 pl-1 border-l border-slate-800">
          {ZOOM_PRESETS.map((preset) => {
            const presetPct = Math.round(preset * 100);
            const isActive = Math.abs(zoomLevel - preset) < 0.04;
            return (
              <button
                key={preset}
                type="button"
                id={`${idPrefix}-preset-${presetPct}`}
                onClick={() => onSetZoom(preset)}
                className={`px-1.5 py-0.5 text-[10px] rounded transition cursor-pointer ${
                  isActive
                    ? 'bg-emerald-900/80 text-emerald-200 font-bold border border-emerald-700/60'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
                }`}
              >
                {presetPct}%
              </button>
            );
          })}
        </div>
      )}

      {/* Fullscreen / Focus Mode Toggle */}
      {onToggleFullscreen && (
        <button
          type="button"
          id={`${idPrefix}-btn-fullscreen`}
          onClick={onToggleFullscreen}
          className="p-1 ml-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-300 transition cursor-pointer border-l border-slate-800 pl-1.5"
          title={isFullscreen ? 'Exit full view' : 'Open full view with zoom'}
          aria-label={isFullscreen ? 'Exit full view' : 'Open full view'}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
};
