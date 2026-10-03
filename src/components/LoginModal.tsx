/**
 * Authentication & Access Modal Component (Neon Auth Architecture)
 *
 * Implements:
 * - Direct authentication against Neon PostgreSQL via secure HttpOnly session cookies
 * - User Registration with atomic First-Admin promotion
 * - Session status display showing authenticated user email & role (ADMIN vs USER)
 * - Safe session logout and revocation
 */

import React, { useState, useEffect } from 'react';
import { api, AuthUser } from '../api/client.js';
import {
  X,
  Lock,
  Mail,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  User,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: (user: AuthUser) => void;
}

export function LoginModal({ isOpen, onClose, onLoginSuccess }: LoginModalProps) {
  const [activeTab, setActiveTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  // Check current session state when opened
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMessage(null);
      api.getAuthMe().then((res) => {
        if (res.authenticated && res.user) {
          setCurrentUser(res.user);
        } else {
          setCurrentUser(null);
        }
      }).catch(() => {
        setCurrentUser(null);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Clear any old stale cookies first so new session becomes immediately effective
      try {
        await api.logout();
      } catch {
        // Safe to ignore if already unauthenticated
      }

      const res = await api.createAuthSession({
        email: email.trim(),
        password: password.trim(),
      });

      if (res.success && res.user) {
        setCurrentUser(res.user);
        setSuccessMessage(`Welcome back, ${res.user.displayName || res.user.email}!`);
        if (onLoginSuccess) {
          onLoginSuccess(res.user);
        }
        setTimeout(() => {
          onClose();
        }, 600);
      } else {
        setError(res.error || 'Authentication failed. Please check your credentials.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please provide an email and password.');
      return;
    }

    if (password.length < 12) {
      setError('Password must be at least 12 characters long for account security.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Clear any old stale cookies first so new admin/user registration is cleanly effective
      try {
        await api.logout();
      } catch {
        // Safe to ignore
      }

      const res = await api.register({
        email: email.trim(),
        password: password.trim(),
        displayName: displayName.trim() || undefined,
      });

      if (res.success && res.user) {
        setCurrentUser(res.user);
        const roleMsg = res.isFirstAdmin
          ? 'Initial administrative account established!'
          : 'User account created successfully!';
        setSuccessMessage(roleMsg);
        if (onLoginSuccess) {
          onLoginSuccess(res.user);
        }
        setTimeout(() => {
          onClose();
        }, 700);
      } else {
        setError(res.error || 'Registration failed.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await api.logout();
      setCurrentUser(null);
      setEmail('');
      setPassword('');
      setSuccessMessage('Logged out successfully.');
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 sm:p-6 text-slate-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Authentication & Access
              </h2>
              <p className="text-xs text-slate-400">Trading Signal Control Panel (Neon Auth)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Alerts */}
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Current Session Indicator */}
        {currentUser ? (
          <div className="mt-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div className="truncate text-xs">
                <div className="font-semibold text-slate-200 truncate">{currentUser.email}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      currentUser.admin
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    }`}
                  >
                    {currentUser.admin ? 'ADMIN' : 'USER'}
                  </span>
                  <span className="text-slate-400 text-[11px]">
                    {currentUser.admin ? 'Full System Privileges' : 'Standard Access'}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-950/60 hover:bg-red-900 border border-red-800/60 text-red-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
              <span>Log Out</span>
            </button>
          </div>
        ) : null}

        {/* Mode Tabs */}
        <div className="flex items-center gap-1 mt-4 p-1 bg-slate-950 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setActiveTab('LOGIN');
              setError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'LOGIN'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('REGISTER');
              setError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'REGISTER'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Sign In Form */}
        {activeTab === 'LOGIN' && (
          <form onSubmit={handlePasswordLogin} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@tradingsignal.io"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              <span>Sign In</span>
            </button>
          </form>
        )}

        {/* Register Form */}
        {activeTab === 'REGISTER' && (
          <form onSubmit={handleRegister} className="mt-4 space-y-3">
            <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/40 text-[11px] text-emerald-300 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-white">First Account Promotion: </span>
                The first registered account automatically becomes the sole System Administrator (ADMIN). Subsequent accounts receive standard USER access.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="trader@domain.com"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Display Name (Optional)
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Trader One"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Choose Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="•••••••••••• (min 12 characters)"
                  required
                  minLength={12}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />}
              <span>Create Admin / User Account</span>
            </button>
          </form>
        )}

        {/* Global Reset / Purge Stale Sessions Option */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
          <span>Having trouble signing in?</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await api.logout();
                setCurrentUser(null);
                setError(null);
                setSuccessMessage('Stale session cookies cleared. You can now register or sign in cleanly.');
              } catch {
                setError('Failed to clear sessions.');
              }
            }}
            className="text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
          >
            Clear Stale Sessions
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginModal;
