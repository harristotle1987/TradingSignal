/**
 * PWA Installation Prompt Component
 * 
 * Reusable, compact install prompt positioned immediately below the navbar.
 * Conforms strictly to:
 * - Standalone detection (never shows if app is running as installed PWA).
 * - Immediate availability for iOS Safari ("Add to Home Screen" instructions).
 * - Real "beforeinstallprompt" event capture and trigger for Chromium/Android/Desktop.
 * - Dynamic installation state checks on mount, visibilitychange, and media query changes.
 * - No horizontal scrolling; compact and aligned with max-w-7xl content width.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X, Share, PlusSquare, Smartphone, CheckCircle2, Monitor } from 'lucide-react';
import appLogo from '../assets/images/app_logo_icon_1786903027875.jpg';

const STORAGE_KEY_DISMISSED_UNTIL = 'pwa_prompt_dismissed_until';
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours cooldown after user clicks dismiss

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    __deferredPwaPrompt?: BeforeInstallPromptEvent | null;
  }
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window !== 'undefined' && window.__deferredPwaPrompt) {
      return window.__deferredPwaPrompt;
    }
    return null;
  });

  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(false);
  const [installedSuccess, setInstalledSuccess] = useState<boolean>(false);

  // Helper to dynamically check if app is running in standalone (installed) mode
  const evaluateStandaloneMode = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;

    const standaloneMedia = window.matchMedia('(display-mode: standalone)').matches;
    const navigatorStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    const androidAppReferrer = document.referrer.includes('android-app://');

    return standaloneMedia || navigatorStandalone || androidAppReferrer;
  }, []);

  // Helper to check dismissal status
  const evaluateDismissal = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      const dismissedUntil = localStorage.getItem(STORAGE_KEY_DISMISSED_UNTIL);
      if (!dismissedUntil) return false;
      const timestamp = parseInt(dismissedUntil, 10);
      return !isNaN(timestamp) && Date.now() < timestamp;
    } catch {
      return false;
    }
  }, []);

  // Main listener and state management effect
  useEffect(() => {
    // 1. Initial State Check
    const standalone = evaluateStandaloneMode();
    setIsStandalone(standalone);

    const dismissed = evaluateDismissal();
    setIsDismissed(dismissed);

    // If already running in standalone mode, clean any legacy storage keys and exit
    if (standalone) {
      return;
    }

    // 2. Detect iOS / iPadOS
    const ua = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    // 3. Check for previously captured early prompt
    if (window.__deferredPwaPrompt && !deferredPrompt) {
      setDeferredPrompt(window.__deferredPwaPrompt);
    }

    // 4. Listen for "beforeinstallprompt" event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__deferredPwaPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    // 5. Listen for custom captured event from index.html
    const handleCustomPromptCaptured = () => {
      if (window.__deferredPwaPrompt) {
        setDeferredPrompt(window.__deferredPwaPrompt);
      }
    };

    // 6. Listen for "appinstalled" event
    const handleAppInstalled = () => {
      console.log('[PWA] App installed event received');
      setInstalledSuccess(true);
      setTimeout(() => {
        setIsStandalone(true);
      }, 2500);
    };

    // 7. Re-check state when app visibility changes or screen matches change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const currentStandalone = evaluateStandaloneMode();
        setIsStandalone(currentStandalone);
        setIsDismissed(evaluateDismissal());
      }
    };

    const mediaQueryList = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches || evaluateStandaloneMode());
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-prompt-captured', handleCustomPromptCaptured);
    window.addEventListener('appinstalled', handleAppInstalled);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    mediaQueryList.addEventListener('change', handleMediaChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-prompt-captured', handleCustomPromptCaptured);
      window.removeEventListener('appinstalled', handleAppInstalled);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      mediaQueryList.removeEventListener('change', handleMediaChange);
    };
  }, [evaluateStandaloneMode, evaluateDismissal, deferredPrompt]);

  // Handle Primary Install / Add to Home Screen action
  const handleInstallAction = async () => {
    if (isIOS) {
      setShowGuide((prev) => !prev);
      return;
    }

    // If native deferred prompt is available, trigger it directly
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        console.log(`[PWA] Install choice outcome: ${choice.outcome}`);
        if (choice.outcome === 'accepted') {
          setInstalledSuccess(true);
          setTimeout(() => {
            setIsStandalone(true);
          }, 2000);
        } else {
          // Temporary 24-hr cooldown on cancel
          localStorage.setItem(STORAGE_KEY_DISMISSED_UNTIL, String(Date.now() + DISMISS_COOLDOWN_MS));
          setIsDismissed(true);
        }
      } catch (err) {
        console.warn('[PWA] Error invoking native prompt:', err);
      } finally {
        setDeferredPrompt(null);
        window.__deferredPwaPrompt = null;
      }
    } else {
      // If deferredPrompt is pending or on a browser where prompt is triggered via address bar
      setShowGuide((prev) => !prev);
    }
  };

  // Handle Dismiss action
  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY_DISMISSED_UNTIL, String(Date.now() + DISMISS_COOLDOWN_MS));
    } catch (e) {
      console.warn('Could not save dismissal state:', e);
    }
    setIsDismissed(true);
    setShowGuide(false);
  };

  // NEVER show prompt if already installed in standalone mode OR if user recently dismissed
  if (isStandalone || isDismissed) {
    return null;
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-3 xs:px-4 sm:px-6 lg:px-8 pt-2.5 pb-1">
      <AnimatePresence>
        <motion.div
          id="pwa-install-prompt-card"
          initial={{ opacity: 0, y: -10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative bg-slate-900/95 border border-slate-800/90 rounded-xl p-2.5 sm:p-3 shadow-md shadow-black/40 backdrop-blur-md overflow-hidden text-slate-100"
        >
          {installedSuccess ? (
            <div className="flex items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-700 text-emerald-400 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-white">App Installed Successfully!</h3>
                  <p className="text-[11px] text-slate-400">Launch Trading Signal AI directly from your home screen or app launcher.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsStandalone(true)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                aria-label="Close notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2.5 sm:gap-4">
                {/* Left: Compact App Icon & Copy */}
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg overflow-hidden border border-slate-700/80 bg-slate-950 flex items-center justify-center shrink-0 shadow-sm">
                    <img
                      src={appLogo}
                      alt="Trading Signal AI"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-xs sm:text-sm font-semibold text-white tracking-tight truncate">
                        Install Trading Signal AI
                      </h3>
                      <span className="text-[9px] font-mono uppercase bg-emerald-950/80 text-emerald-300 px-1.5 py-0.2 border border-emerald-800/60 rounded shrink-0 hidden xs:inline-block">
                        Instant Alerts
                      </span>
                    </div>
                    <p className="text-[10px] sm:text-xs text-slate-400 truncate">
                      {isIOS
                        ? 'Tap Share → Add to Home Screen for standalone alerts'
                        : 'Install standalone app for real-time alerts & multi-asset scanning'}
                    </p>
                  </div>
                </div>

                {/* Right: Platform-Specific Action & Dismiss */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {isIOS ? (
                    <button
                      type="button"
                      id="pwa-ios-install-btn"
                      onClick={handleInstallAction}
                      className="px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] sm:text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 min-h-[34px] cursor-pointer"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>{showGuide ? 'Hide Steps' : 'Add to Home Screen'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      id="pwa-native-install-btn"
                      onClick={handleInstallAction}
                      className="px-3 sm:px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] sm:text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 min-h-[34px] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Install App</span>
                    </button>
                  )}

                  <button
                    type="button"
                    id="pwa-dismiss-btn"
                    onClick={handleDismiss}
                    className="p-1 sm:p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer min-h-[34px] min-w-[34px] flex items-center justify-center"
                    title="Dismiss prompt"
                    aria-label="Dismiss installation prompt"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Step-by-Step Guidance Box for iOS Safari / Desktop Manual Flow */}
              {showGuide && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="mt-2.5 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-300 space-y-1.5 bg-slate-950/60 p-2.5 rounded-lg"
                >
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                    <span>{isIOS ? 'How to Add on iOS Safari:' : 'How to Install in Browser:'}</span>
                  </div>

                  {isIOS ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-[10px] sm:text-[11px]">
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-md">
                        <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0">1</span>
                        <span>Tap <Share className="w-3 h-3 inline text-blue-400 mx-0.5" /> <strong>Share</strong> icon in Safari toolbar</span>
                      </div>
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-md">
                        <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0">2</span>
                        <span>Select <PlusSquare className="w-3 h-3 inline text-emerald-400 mx-0.5" /> <strong>Add to Home Screen</strong></span>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-[10px] sm:text-[11px]">
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-md">
                        <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0">1</span>
                        <span>Click <Download className="w-3 h-3 inline text-emerald-400 mx-0.5" /> <strong>Install</strong> in the URL address bar (⊕ icon)</span>
                      </div>
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-md">
                        <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0">2</span>
                        <span>Or open menu (<Monitor className="w-3 h-3 inline text-blue-400 mx-0.5" /> ⋮) → <strong>Install Trading Signal AI</strong></span>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
