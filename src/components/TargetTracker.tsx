/**
 * TargetTracker Component (Gate 2 & 6 - Authoritative Target Progress & Manual Refresh)
 *
 * Displays TP1, TP2, TP3 and Stop Loss target states, actual hit prices,
 * and exact ISO/UTC hit timestamps directly from authoritative backend signal state.
 * Delegates the manual refresh/checking to the highly reusable SignalRefreshButton component.
 */

import { useState } from 'react';
import { TradingSignal } from '../types/index.js';
import { CheckCircle2, Clock, Check, ShieldAlert, Award } from 'lucide-react';
import { SignalRefreshButton } from './SignalRefreshButton.js';
import { formatStatus, getDynamicPrecision } from '../utils/formatters.js';

interface TargetTrackerProps {
  signal: TradingSignal;
  precision?: number;
  onSignalRefreshed?: (updatedSignal: TradingSignal) => void;
}

export function TargetTracker({ signal, precision, onSignalRefreshed }: TargetTrackerProps) {
  // Use state to allow instantaneous, localized UI updates when user triggers manual refresh
  const [currentSignal, setCurrentSignal] = useState<TradingSignal>(signal);

  // Sync state if parent passes a different signal ID
  const [prevSignalId, setPrevSignalId] = useState(signal.id);
  if (signal.id !== prevSignalId) {
    setCurrentSignal(signal);
    setPrevSignalId(signal.id);
  }

  const prec = precision ?? (currentSignal?.entryPrice ? getDynamicPrecision(currentSignal.entryPrice, currentSignal.symbol) : 2);

  const tp1 = currentSignal?.tp1 ?? currentSignal?.takeProfit;
  const tp2 = currentSignal?.tp2;
  const tp3 = currentSignal?.tp3;
  const sl = currentSignal?.stopLoss;

  const entry = currentSignal?.entryPrice ?? 0;

  // Exact R:R ratios computed directly from actual displayed prices
  const isBuy = currentSignal?.direction === 'BUY';
  const risk = sl !== undefined && sl !== null ? (isBuy ? (entry - sl) : (sl - entry)) : 0;
  
  const tp1Rr = risk > 0 && tp1 !== undefined && tp1 !== null ? Number((Math.abs(tp1 - entry) / risk).toFixed(2)) : 0;
  const tp2Rr = tp2 !== undefined && tp2 !== null && risk > 0 ? Number((Math.abs(tp2 - entry) / risk).toFixed(2)) : 0;
  const tp3Rr = tp3 !== undefined && tp3 !== null && risk > 0 ? Number((Math.abs(tp3 - entry) / risk).toFixed(2)) : 0;

  // Safe toFixed formatter
  const formatVal = (v: any) => {
    if (v === undefined || v === null || isNaN(Number(v))) return '--';
    return Number(v).toFixed(prec);
  };

  // Authoritative statuses from backend signal object
  const tp1Hit = currentSignal?.tp1Status === 'HIT' || currentSignal?.status === 'TP1_HIT' || currentSignal?.status === 'TP2_HIT' || currentSignal?.status === 'TP3_HIT' || currentSignal?.status === 'COMPLETED';
  const tp2Hit = currentSignal?.tp2Status === 'HIT' || currentSignal?.status === 'TP2_HIT' || currentSignal?.status === 'TP3_HIT' || currentSignal?.status === 'COMPLETED';
  const tp3Hit = currentSignal?.tp3Status === 'HIT' || currentSignal?.status === 'TP3_HIT' || currentSignal?.status === 'COMPLETED';
  const slHit = currentSignal?.slStatus === 'HIT' || currentSignal?.status === 'SL_HIT' || currentSignal?.status === 'STOPPED_OUT';

  const isCompleted = currentSignal?.status === 'COMPLETED' || (tp1Hit && tp2Hit && tp3Hit);
  const isStoppedOut = currentSignal?.status === 'STOPPED_OUT' || slHit;

  const formatHitTime = (isoString?: string) => {
    if (!isoString) return null;
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    } catch {
      return isoString;
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4 font-mono shadow-sm">
      {/* Target Progress Stepper Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Target Progress</span>
          {isCompleted ? (
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 text-[11px] font-bold flex items-center gap-1.5 shadow-sm">
              <Award className="w-3.5 h-3.5 text-emerald-400" /> TRADE COMPLETED
            </span>
          ) : isStoppedOut ? (
            <span className="px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800 text-[11px] font-bold flex items-center gap-1.5 shadow-sm">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> STOPPED OUT
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-slate-900 text-sky-400 border border-slate-800 text-[10px] font-bold">
              {formatStatus(currentSignal?.status || 'WAITING_ENTRY')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Target Stepper Chips */}
          <div className="hidden md:flex items-center gap-2 text-[11px]">
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold border ${tp1Hit ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800' : 'bg-slate-900 text-slate-500 border-slate-800'}`}>
              {tp1Hit ? <Check className="w-3 h-3 text-emerald-400" /> : '○'} TP1 {tp1Hit ? 'HIT' : 'PENDING'}
            </span>
            {tp2 !== undefined && (
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold border ${tp2Hit ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800' : 'bg-slate-900 text-slate-500 border-slate-800'}`}>
                {tp2Hit ? <Check className="w-3 h-3 text-emerald-400" /> : '○'} TP2 {tp2Hit ? 'HIT' : 'PENDING'}
              </span>
            )}
            {tp3 !== undefined && (
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold border ${tp3Hit ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800' : 'bg-slate-900 text-slate-500 border-slate-800'}`}>
                {tp3Hit ? <Check className="w-3 h-3 text-emerald-400" /> : '○'} TP3 {tp3Hit ? 'HIT' : 'PENDING'}
              </span>
            )}
          </div>

          {/* Reusable Signal Refresh Button */}
          <SignalRefreshButton
            signal={currentSignal}
            onSignalRefreshed={(updated) => {
              setCurrentSignal(updated);
              if (onSignalRefreshed) {
                onSignalRefreshed(updated);
              }
            }}
          />
        </div>
      </div>

      {/* Target Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* TP1 Card */}
        <div className={`p-3 rounded-lg border flex flex-col justify-between space-y-2 ${tp1Hit ? 'bg-emerald-950/30 border-emerald-800/80' : 'bg-slate-900/60 border-slate-800'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400">TP1 Target</span>
            {tp1Hit ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" /> ✓ HIT
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                PENDING
              </span>
            )}
          </div>
          <div>
            <div className="text-sm font-bold text-emerald-400">{formatVal(tp1)}</div>
            <div className="text-[11px] text-blue-400 font-semibold mt-0.5">R:R: {tp1Rr}:1</div>
            {tp1Hit && (
              <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 text-[10px] text-slate-300 space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Hit Price:</span>
                  <span className="font-bold text-emerald-300">{formatVal(currentSignal?.tp1HitPrice ? currentSignal.tp1HitPrice : tp1)}</span>
                </div>
                {currentSignal?.tp1HitAt && (
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5 text-slate-500" /> Hit Time:</span>
                    <span className="text-[9px] font-mono text-slate-300">{formatHitTime(currentSignal.tp1HitAt)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* TP2 Card */}
        {tp2 !== undefined && (
          <div className={`p-3 rounded-lg border flex flex-col justify-between space-y-2 ${tp2Hit ? 'bg-emerald-950/30 border-emerald-800/80' : 'bg-slate-900/60 border-slate-800'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400">TP2 Target</span>
              {tp2Hit ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> ✓ HIT
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  PENDING
                </span>
              )}
            </div>
            <div>
              <div className="text-sm font-bold text-emerald-300">{formatVal(tp2)}</div>
              <div className="text-[11px] text-blue-400 font-semibold mt-0.5">R:R: {tp2Rr}:1</div>
              {tp2Hit && (
                <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 text-[10px] text-slate-300 space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Hit Price:</span>
                    <span className="font-bold text-emerald-300">{formatVal(currentSignal?.tp2HitPrice ? currentSignal.tp2HitPrice : tp2)}</span>
                  </div>
                  {currentSignal?.tp2HitAt && (
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5 text-slate-500" /> Hit Time:</span>
                      <span className="text-[9px] font-mono text-slate-300">{formatHitTime(currentSignal.tp2HitAt)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TP3 Card */}
        {tp3 !== undefined && (
          <div className={`p-3 rounded-lg border flex flex-col justify-between space-y-2 ${tp3Hit ? 'bg-emerald-950/30 border-emerald-800/80' : 'bg-slate-900/60 border-slate-800'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400">TP3 Target</span>
              {tp3Hit ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> ✓ HIT
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  PENDING
                </span>
              )}
            </div>
            <div>
              <div className="text-sm font-bold text-emerald-200">{formatVal(tp3)}</div>
              <div className="text-[11px] text-blue-400 font-semibold mt-0.5">R:R: {tp3Rr}:1</div>
              {tp3Hit && (
                <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 text-[10px] text-slate-300 space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Hit Price:</span>
                    <span className="font-bold text-emerald-300">{formatVal(currentSignal?.tp3HitPrice ? currentSignal.tp3HitPrice : tp3)}</span>
                  </div>
                  {currentSignal?.tp3HitAt && (
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5 text-slate-500" /> Hit Time:</span>
                      <span className="text-[9px] font-mono text-slate-300">{formatHitTime(currentSignal.tp3HitAt)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stop Loss Card */}
        <div className={`p-3 rounded-lg border flex flex-col justify-between space-y-2 ${slHit ? 'bg-rose-950/40 border-rose-800/80' : 'bg-slate-900/60 border-slate-800'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400">Stop Loss</span>
            {slHit ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3 text-rose-400" /> ❌ HIT
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                ACTIVE
              </span>
            )}
          </div>
          <div>
            <div className="text-sm font-bold text-rose-400">{formatVal(sl)}</div>
            {slHit && (
              <div className="mt-1.5 pt-1.5 border-t border-rose-800/80 text-[10px] text-slate-300 space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Hit Price:</span>
                  <span className="font-bold text-rose-300">{formatVal(currentSignal?.stopLossHitPrice ? currentSignal.stopLossHitPrice : sl)}</span>
                </div>
                {currentSignal?.stopLossHitAt && (
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5 text-slate-500" /> Hit Time:</span>
                    <span className="text-[9px] font-mono text-slate-300">{formatHitTime(currentSignal.stopLossHitAt)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
