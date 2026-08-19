import { useState, MouseEvent } from 'react';
import { TradingSignal } from '../types/index.js';
import { RefreshCw } from 'lucide-react';
import { api } from '../api/client.js';

interface SignalRefreshButtonProps {
  signal: TradingSignal;
  onSignalRefreshed?: (updatedSignal: TradingSignal) => void;
  className?: string;
}

export function SignalRefreshButton({ signal, onSignalRefreshed, className = '' }: SignalRefreshButtonProps) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const handleRefresh = async (e: MouseEvent) => {
    e.stopPropagation(); // Prevent parent card clicks or navigation
    if (loading) return;
    setLoading(true);
    setFeedback(null);

    console.log('[SignalRefreshButton] Triggering manual signal refresh:', {
      signalId: signal.id,
      symbol: signal.symbol,
      currentStatus: signal.status,
      windowOrigin: typeof window !== 'undefined' ? window.location.origin : 'N/A',
      envApiUrl: (import.meta as any).env?.VITE_API_URL || 'undefined',
      timestamp: new Date().toISOString()
    });

    try {
      const data = await api.refreshSignal(signal);

      console.log('[SignalRefreshButton] Refresh response received:', {
        signalId: signal.id,
        success: data?.success,
        changed: data?.changed,
        message: data?.message,
        currentPrice: data?.currentPrice,
        timestamp: data?.timestamp
      });

      if (data && data.success) {
        if (data.signal && onSignalRefreshed) {
          onSignalRefreshed(data.signal as unknown as TradingSignal);
        }
        setFeedback(data.message || '✓ Checked');
        setLastChecked(data.lastChecked || new Date().toLocaleTimeString());
      } else {
        setFeedback(data.message || 'Verification failed');
      }
    } catch (err: any) {
      let errMsg = 'Connection issue. Try again.';
      if (err instanceof Error) {
        // Try to parse the backend JSON error message if present in the thrown message
        const match = err.message.match(/:\s*({.+})/);
        if (match && match[1]) {
          try {
            const parsed = JSON.parse(match[1]);
            if (parsed && parsed.message) {
              errMsg = parsed.message;
            }
          } catch {
            errMsg = err.message;
          }
        } else {
          errMsg = err.message;
        }
      }
      setFeedback(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`flex flex-col items-end gap-1.5 font-mono ${className}`}>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={loading}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold border transition cursor-pointer select-none ${
          loading 
            ? 'bg-slate-900 text-sky-400 border-sky-800/50' 
            : 'bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white border-slate-800 hover:border-slate-750'
        }`}
        title="Check latest verified market price manually"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : 'text-slate-400'}`} />
        {loading ? 'Checking...' : 'Refresh'}
      </button>

      {/* Status Meta Info */}
      {(lastChecked || feedback || loading) && (
        <div className="text-[10px] text-right space-y-0.5 max-w-[200px] leading-tight">
          {loading ? (
            <span className="text-sky-400 font-bold">Verifying...</span>
          ) : (
            <>
              {feedback && (
                <div className={`font-semibold ${
                  feedback.toLowerCase().includes('not found') || 
                  feedback.toLowerCase().includes('failed') || 
                  feedback.toLowerCase().includes('error') || 
                  feedback.toLowerCase().includes('issue')
                    ? 'text-rose-400' 
                    : 'text-emerald-400'
                }`}>
                  {feedback}
                </div>
              )}
              {lastChecked && <div className="text-slate-500">Last checked: <span className="text-slate-300 font-mono">{lastChecked}</span></div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
