/**
 * PWA Installation Banner Component
 * 
 * Compact, premium PWA install prompt positioned directly below the navbar.
 * Features:
 * - Detects standalone / already installed mode and never displays if installed.
 * - Handles Android/Chromium/Desktop native "beforeinstallprompt" flow.
 * - Handles iOS/Safari "Add to Home Screen" instructions.
 * - Respects dismiss cooldown via localStorage (7 days).
 * - Smooth, lightweight entry/exit transition using motion/react.
 * - Uses existing app logo and adheres strictly to the app design system.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X, Share, PlusSquare, Smartphone, CheckCircle2 } from 'lucide-react';
import appLogo from '../assets/images/app_logo_icon_1786903027875.jpg';

const STORAGE_KEY_INSTALLED = 'pwa_installed';
const STORAGE_KEY_DISMISSED_UNTIL = 'pwa_prompt_dismissed_until';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installedSuccess, setInstalledSuccess] = useState(false);

  // Helper to check if already installed or standalone
  const checkIsInstalled = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;

    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://');

    const isPersistedInstalled = localStorage.getItem(STORAGE_KEY_INSTALLED) === 'true';

    return isStandaloneMode || isPersistedInstalled;
  }, []);

  // Helper to check if currently under dismissal cooldown
  const checkIsDismissed = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    const dismissedUntil = localStorage.getItem(STORAGE_KEY_DISMISSED_UNTIL);
    if (!dismissedUntil) return false;
    const timestamp = parseInt(dismissedUntil, 10);
    return !isNaN(timestamp) && Date.now() < timestamp;
  }, []);

  useEffect(() => {
    // 1. If already installed, never show prompt
    if (checkIsInstalled()) {
      return;
    }

    // 2. If user recently dismissed, do not show
    if (checkIsDismissed()) {
      return;
    }

    // 3. Platform Detection
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

    setIsIOS(isIOSDevice);

    // On iOS Safari, beforeinstallprompt is not supported, so if not installed and not dismissed, show iOS prompt
    if (isIOSDevice) {
      // Small timeout to allow smooth mount without layout shift
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 800);
      return () => clearTimeout(timer);
    }

    // 4. Android / Chrome / Desktop PWA prompt listener
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      setIsVisible(true);
    };

    // 5. Watch for successful installation
    const handleAppInstalled = () => {
      console.log('[PWA] Application successfully installed');
      localStorage.setItem(STORAGE_KEY_INSTALLED, 'true');
      setInstalledSuccess(true);
      setTimeout(() => {
        setIsVisible(false);
      }, 2500);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [checkIsInstalled, checkIsDismissed]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      if (isIOS) {
        setShowIOSGuide((prev) => !prev);
      }
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      console.log(`[PWA] Install prompt outcome: ${choice.outcome}`);

      if (choice.outcome === 'accepted') {
        localStorage.setItem(STORAGE_KEY_INSTALLED, 'true');
        setInstalledSuccess(true);
        setTimeout(() => {
          setIsVisible(false);
        }, 2000);
      } else {
        // If dismissed by user in native dialog, apply brief cooldown
        localStorage.setItem(STORAGE_KEY_DISMISSED_UNTIL, String(Date.now() + 2 * 24 * 60 * 60 * 1000));
        setIsVisible(false);
      }
    } catch (err) {
      console.warn('[PWA] Installation error:', err);
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY_DISMISSED_UNTIL, String(Date.now() + DISMISS_COOLDOWN_MS));
    setIsVisible(false);
    setShowIOSGuide(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-3 xs:px-4 sm:px-6 lg:px-8 pt-2 sm:pt-3">
      <AnimatePresence>
        <motion.div
          id="pwa-install-banner"
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="relative bg-slate-900/95 border border-slate-800/90 rounded-xl p-2.5 sm:p-3 shadow-lg shadow-black/40 backdrop-blur-md overflow-hidden text-slate-100"
        >
          {installedSuccess ? (
            <div className="flex items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-400 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-white">App Installed Successfully!</h3>
                  <p className="text-[11px] text-slate-400">Launch Trading Signal AI from your home screen or app drawer.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsVisible(false)}
                className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2.5 sm:gap-4">
                {/* Left: App Logo & Info */}
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg overflow-hidden border border-slate-700/80 bg-slate-950 flex items-center justify-center shrink-0 shadow-sm">
                    <img
                      src={appLogo}
                      alt="Trading Signal AI App Icon"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xs sm:text-sm font-semibold text-white tracking-tight truncate">
                        Install Trading Signal AI
                      </h3>
                      <span className="text-[9px] font-mono uppercase bg-emerald-950/80 text-emerald-300 px-1.5 py-0.2 border border-emerald-800/60 rounded shrink-0 hidden xs:inline-block">
                        Instant Alerts
                      </span>
                    </div>
                    <p className="text-[10px] sm:text-xs text-slate-400 truncate">
                      {isIOS
                        ? 'Add to Home Screen for instant background push notifications & full-screen trading'
                        : 'Install standalone app for real-time alerts and high-performance scanning'}
                    </p>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {isIOS ? (
                    <button
                      type="button"
                      id="pwa-ios-add-btn"
                      onClick={() => setShowIOSGuide((prev) => !prev)}
                      className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] sm:text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 min-h-[34px] cursor-pointer"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>{showIOSGuide ? 'Hide Steps' : 'Add to Home Screen'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      id="pwa-install-app-btn"
                      onClick={handleInstallClick}
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
                    title="Dismiss for 7 days"
                    aria-label="Dismiss installation prompt"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* iOS Safari Step-by-Step Guidance Box */}
              {isIOS && showIOSGuide && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="mt-2.5 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-300 space-y-1.5 bg-slate-950/60 p-2.5 rounded-lg"
                >
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                    <span>How to add on iOS Safari:</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-[10px] sm:text-[11px]">
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2 py-1.5 rounded-md">
                      <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0">1</span>
                      <span>Tap <Share className="w-3 h-3 inline text-blue-400 mx-0.5" /> <strong>Share</strong> in Safari menu</span>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2 py-1.5 rounded-md">
                      <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0">2</span>
                      <span>Select <PlusSquare className="w-3 h-3 inline text-emerald-400 mx-0.5" /> <strong>Add to Home Screen</strong></span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
