import React, { useState, useEffect } from 'react';
import { Sliders, ShieldCheck, Zap, RotateCcw, CheckCircle2, AlertTriangle, Info, Sparkles } from 'lucide-react';
import { api } from '../api/client.js';
import { SensitivityProfileName, SensitivityProfileConfig } from '../types/index.js';

interface SignalSensitivitySelectorProps {
  onProfileChanged?: (profile: SensitivityProfileName, config: SensitivityProfileConfig) => void;
  compact?: boolean;
}

export const SignalSensitivitySelector: React.FC<SignalSensitivitySelectorProps> = ({
  onProfileChanged,
  compact = false,
}) => {
  const [activeProfile, setActiveProfile] = useState<SensitivityProfileName>('BALANCED');
  const [profiles, setProfiles] = useState<Record<SensitivityProfileName, SensitivityProfileConfig> | null>(null);
  const [currentConfig, setCurrentConfig] = useState<SensitivityProfileConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [updating, setUpdating] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Custom configuration sliders state
  const [customScore, setCustomScore] = useState<number>(65);
  const [customRR, setCustomRR] = useState<number>(1.5);
  const [customNetRR, setCustomNetRR] = useState<number>(1.10);

  const fetchProfiles = async () => {
    try {
      setLoading(true);
      const res = await api.getSensitivityProfiles();
      if (res && res.success) {
        setActiveProfile(res.activeProfile);
        setProfiles(res.profiles);
        setCurrentConfig(res.currentConfig);
        if (res.profiles?.CUSTOM) {
          setCustomScore(res.profiles.CUSTOM.signalThreshold || 65);
          setCustomRR(res.profiles.CUSTOM.minimumRR || 1.5);
          setCustomNetRR(res.profiles.CUSTOM.minimumNetRR || 1.10);
        }
      }
    } catch (err) {
      console.error('Failed to load sensitivity profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  const handleSelectProfile = async (
    profileName: SensitivityProfileName,
    customOverrides?: Partial<SensitivityProfileConfig>
  ) => {
    try {
      setUpdating(true);
      setMessage(null);
      const res = await api.updateSensitivityProfile(profileName, customOverrides);
      if (res && res.success) {
        setActiveProfile(res.activeProfile);
        setCurrentConfig(res.currentConfig);
        setMessage({
          text: `Sensitivity adjusted to ${res.currentConfig.label}. Signals will now calibrate to ≥${res.currentConfig.signalThreshold} score and ≥${res.currentConfig.minimumRR}:1 R:R.`,
          type: 'success',
        });
        if (onProfileChanged) {
          onProfileChanged(res.activeProfile, res.currentConfig);
        }
      } else {
        setMessage({ text: 'Failed to update sensitivity profile', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err?.message || 'Error updating sensitivity profile', type: 'error' });
    } finally {
      setUpdating(false);
    }
  };

  const handleReset = async () => {
    try {
      setUpdating(true);
      setMessage(null);
      const res = await api.resetSensitivityProfile();
      if (res && res.success) {
        setActiveProfile(res.activeProfile);
        setCurrentConfig(res.currentConfig);
        setMessage({
          text: 'Restored to Balanced (Recommended) profile.',
          type: 'success',
        });
        if (onProfileChanged) {
          onProfileChanged(res.activeProfile, res.currentConfig);
        }
      }
    } catch (err: any) {
      setMessage({ text: err?.message || 'Error resetting profile', type: 'error' });
    } finally {
      setUpdating(false);
    }
  };

  if (loading && !profiles) {
    return (
      <div id="sensitivity-selector-loading" className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 animate-pulse text-slate-400 text-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Sliders className="w-5 h-5 text-indigo-400 animate-spin" />
          <span>Loading Signal Sensitivity Profiles...</span>
        </div>
      </div>
    );
  }

  const profileCards: {
    key: SensitivityProfileName;
    title: string;
    badge: string;
    icon: React.ReactNode;
    score: number;
    rr: number;
    netRR: number;
    frequency: string;
    description: string;
    borderActive: string;
    bgActive: string;
    badgeColor: string;
  }[] = [
    {
      key: 'BALANCED',
      title: 'Balanced',
      badge: 'Recommended',
      icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
      score: 65,
      rr: 1.5,
      netRR: 1.10,
      frequency: '~2 – 5 signals / day',
      description: 'Removes signal starvation while keeping robust risk management. Catches high-conviction swing & trend setups.',
      borderActive: 'border-emerald-500 shadow-emerald-500/20',
      bgActive: 'bg-emerald-950/20',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    },
    {
      key: 'ACTIVE',
      title: 'Active Trader',
      badge: 'High Frequency',
      icon: <Zap className="w-4 h-4 text-amber-400" />,
      score: 62,
      rr: 1.3,
      netRR: 1.05,
      frequency: '~5 – 10 signals / day',
      description: 'Optimized for intraday market participants. Lowers friction barriers for 15m/1h momentum breakouts.',
      borderActive: 'border-amber-500 shadow-amber-500/20',
      bgActive: 'bg-amber-950/20',
      badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    },
    {
      key: 'CONSERVATIVE',
      title: 'Conservative',
      badge: 'Ultra-Selective',
      icon: <ShieldCheck className="w-4 h-4 text-blue-400" />,
      score: 72,
      rr: 1.8,
      netRR: 1.30,
      frequency: '~1 – 3 signals / week',
      description: 'Original institutional threshold requiring near-perfect MTF alignment and high 1.8:1 gross R:R.',
      borderActive: 'border-blue-500 shadow-blue-500/20',
      bgActive: 'bg-blue-950/20',
      badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    },
    {
      key: 'CUSTOM',
      title: 'Custom',
      badge: 'Tailored',
      icon: <Sliders className="w-4 h-4 text-purple-400" />,
      score: customScore,
      rr: customRR,
      netRR: customNetRR,
      frequency: 'User Defined',
      description: 'Specify bespoke score and risk-reward bounds within safe mathematical limits.',
      borderActive: 'border-purple-500 shadow-purple-500/20',
      bgActive: 'bg-purple-950/20',
      badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    },
  ];

  return (
    <div id="signal-sensitivity-selector" className="space-y-4">
      {/* Header with status badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-semibold text-slate-100">Signal Strictness & Sensitivity</h3>
            <span
              id="active-sensitivity-pill"
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                activeProfile === 'BALANCED'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : activeProfile === 'ACTIVE'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : activeProfile === 'CONSERVATIVE'
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                  : 'bg-purple-500/10 text-purple-400 border-purple-500/30'
              }`}
            >
              Active: {currentConfig?.label || activeProfile}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Control signal generation strictness. Lowering thresholds safely unlocks pristine trade setups without compromising core capital protection.
          </p>
        </div>

        <button
          id="btn-reset-sensitivity"
          onClick={handleReset}
          disabled={updating || activeProfile === 'BALANCED'}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeProfile === 'BALANCED'
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 shadow-sm'
          }`}
          title="Restore recommended Balanced settings"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${updating ? 'animate-spin' : ''}`} />
          <span>Restore Recommended</span>
        </button>
      </div>

      {/* Feedback banner */}
      {message && (
        <div
          id="sensitivity-feedback-banner"
          className={`p-3 rounded-lg border text-xs flex items-center space-x-2 ${
            message.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Profile Selector Cards */}
      <div className={`grid gap-3 ${compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'}`}>
        {profileCards.map((card) => {
          const isSelected = activeProfile === card.key;
          return (
            <div
              key={card.key}
              id={`sensitivity-card-${card.key.toLowerCase()}`}
              onClick={() => {
                if (card.key !== 'CUSTOM') {
                  handleSelectProfile(card.key);
                } else {
                  handleSelectProfile('CUSTOM', {
                    signalThreshold: customScore,
                    minimumScore: customScore,
                    minimumRR: customRR,
                    minimumNetRR: customNetRR,
                  });
                }
              }}
              className={`p-4 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                isSelected
                  ? `${card.borderActive} ${card.bgActive} shadow-lg ring-1 ring-offset-0 ring-indigo-500/30`
                  : 'bg-slate-900/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    {card.icon}
                    <h4 className="text-sm font-semibold text-slate-100">{card.title}</h4>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${card.badgeColor}`}>
                    {card.badge}
                  </span>
                </div>

                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  {card.description}
                </p>

                {/* Key Metrics Matrix */}
                <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-950/60 rounded-lg border border-slate-800/60 text-xs mb-3">
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Score Hurdle</span>
                    <span className="font-semibold text-slate-200">≥ {card.score}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Gross R:R</span>
                    <span className="font-semibold text-slate-200">≥ {card.rr}:1</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Net R:R</span>
                    <span className="font-semibold text-slate-200">≥ {card.netRR}:1</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Est. Frequency</span>
                    <span className="font-semibold text-indigo-300">{card.frequency}</span>
                  </div>
                </div>
              </div>

              {/* Selection button */}
              <button
                type="button"
                disabled={updating}
                onClick={(e) => {
                  e.stopPropagation();
                  if (card.key !== 'CUSTOM') {
                    handleSelectProfile(card.key);
                  } else {
                    handleSelectProfile('CUSTOM', {
                      signalThreshold: customScore,
                      minimumScore: customScore,
                      minimumRR: customRR,
                      minimumNetRR: customNetRR,
                    });
                  }
                }}
                className={`w-full py-2 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center space-x-1.5 ${
                  isSelected
                    ? 'bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/20'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                {isSelected ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    <span>Active Profile</span>
                  </>
                ) : (
                  <span>Select {card.title}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Custom sliders accordion if CUSTOM is active */}
      {activeProfile === 'CUSTOM' && (
        <div id="custom-sensitivity-controls" className="p-4 bg-slate-900/90 rounded-xl border border-purple-500/40 space-y-4">
          <div className="flex items-center space-x-2 text-purple-300">
            <Sliders className="w-4 h-4" />
            <h4 className="text-sm font-semibold">Custom Sensitivity Thresholds</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Minimum Score</span>
                <span className="font-bold text-purple-300">{customScore}</span>
              </div>
              <input
                id="custom-score-slider"
                type="range"
                min="55"
                max="80"
                step="1"
                value={customScore}
                onChange={(e) => setCustomScore(Number(e.target.value))}
                className="w-full accent-purple-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
              <span className="text-[10px] text-slate-500">Safe bounds: 55 - 80 (Balanced: 65)</span>
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Minimum Gross R:R</span>
                <span className="font-bold text-purple-300">{customRR.toFixed(1)}:1</span>
              </div>
              <input
                id="custom-rr-slider"
                type="range"
                min="1.2"
                max="2.5"
                step="0.1"
                value={customRR}
                onChange={(e) => setCustomRR(Number(e.target.value))}
                className="w-full accent-purple-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
              <span className="text-[10px] text-slate-500">Safe bounds: 1.2:1 - 2.5:1 (Balanced: 1.5:1)</span>
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Minimum Net R:R</span>
                <span className="font-bold text-purple-300">{customNetRR.toFixed(2)}:1</span>
              </div>
              <input
                id="custom-net-rr-slider"
                type="range"
                min="1.0"
                max="2.0"
                step="0.05"
                value={customNetRR}
                onChange={(e) => setCustomNetRR(Number(e.target.value))}
                className="w-full accent-purple-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
              <span className="text-[10px] text-slate-500">Safe bounds: 1.0:1 - 2.0:1 (Balanced: 1.10:1)</span>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              id="btn-apply-custom-sensitivity"
              onClick={() => {
                handleSelectProfile('CUSTOM', {
                  signalThreshold: customScore,
                  minimumScore: customScore,
                  minimumRR: customRR,
                  minimumNetRR: customNetRR,
                });
              }}
              disabled={updating}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-md transition-all flex items-center space-x-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Apply Custom Thresholds</span>
            </button>
          </div>
        </div>
      )}

      {/* Safety & Explanatory Notice */}
      <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-start space-x-2.5">
        <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <p>
          <strong className="text-slate-300">Preserved Hard Risk Safeguards:</strong> Changing sensitivity does <span className="underline decoration-slate-600">NOT</span> bypass Stop Loss calculation, Multi-Timeframe Confirmation, or Negative Expectancy gates. It calibrates the threshold score hurdles to let valid setups through instead of discarding them during calm or moderately trending market regimes.
        </p>
      </div>
    </div>
  );
};
