/**
 * Centralized Human-Readable Label Formatters
 * 
 * Ensures backend enums/constants remain strictly untouched while NEVER
 * exposing raw machine identifiers or snake_case constants to the UI.
 * 
 * Required Examples:
 * BEST_TRADE -> BEST TRADE
 * HIGH_CONFLUENCE -> HIGH CONFLUENCE
 * MULTI_TF_REALISM -> MULTI-TF REALISM
 * AUTOMATED_BEST_TRADE -> AUTOMATED BEST TRADE
 */

const KNOWN_LABEL_MAP: Record<string, string> = {
  // Rank Tiers & Badges
  BEST_TRADE: 'BEST TRADE',
  HIGH_CONFLUENCE: 'HIGH CONFLUENCE',
  MULTI_TF_REALISM: 'MULTI-TF REALISM',
  AUTOMATED_BEST_TRADE: 'AUTOMATED BEST TRADE',
  SECOND_BEST: 'SECOND BEST',
  SUGGESTION: 'SUGGESTION',
  TOP_TRADE: 'TOP TRADE',
  VALIDATED: 'VALIDATED',

  // Signal Lifecycle Statuses
  ACTIVE: 'ACTIVE',
  TP1_HIT: 'TP1 HIT',
  TP2_HIT: 'TP2 HIT',
  TP3_HIT: 'TP3 HIT',
  SL_HIT: 'SL HIT',
  AMBIGUOUS: 'AMBIGUOUS',
  EXPIRED: 'EXPIRED',
  INVALIDATED: 'INVALIDATED',
  NO_TRADE: 'NO TRADE',
  NO_TRADE_OPPORTUNITY: 'NO VALID SETUP',

  // Market Sessions
  MARKET_OPEN: 'MARKET OPEN',
  MARKET_CLOSED: 'MARKET CLOSED',
  OUTSIDE_TRADING_SESSION: 'OUTSIDE TRADING SESSION',

  // Strategies & Classifications
  TREND_CONTINUATION: 'Trend Continuation',
  MEAN_REVERSION: 'Mean Reversion',
  BREAKOUT: 'Breakout',
  MOMENTUM: 'Momentum',
  VOLATILITY_EXPANSION: 'Volatility Expansion',

  // Asset Categories
  CRYPTO: 'CRYPTO',
  FOREX: 'FOREX',
  STOCKS: 'STOCKS',
  COMMODITIES: 'COMMODITIES',
  INDICES: 'INDICES',

  // Event Sources & Providers
  HISTORICAL_BACKFILL: 'HISTORICAL BACKFILL',
  LIVE_STREAM: 'LIVE STREAM',
  LIVE: 'LIVE',
  TWELVEDATA: 'Twelve Data',
  BITGET: 'Bitget',
  FINNHUB: 'Finnhub',
  COINBASE: 'Coinbase',
  BINANCE: 'Binance',
};

/**
 * Universal Human-Readable Label Formatter.
 * Converts machine tokens, snake_case strings, and raw enums to clean UI labels.
 */
export function formatLabel(input?: string | null): string {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  // Direct exact match
  if (KNOWN_LABEL_MAP[trimmed]) {
    return KNOWN_LABEL_MAP[trimmed];
  }

  // Check uppercase match
  const upper = trimmed.toUpperCase();
  if (KNOWN_LABEL_MAP[upper]) {
    return KNOWN_LABEL_MAP[upper];
  }

  // Handle bracketed tokens like "[TOP TRADE]" or "[AUTOMATED_BEST_TRADE]"
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    return `[${formatLabel(inner)}]`;
  }

  // General transformation for unmapped strings
  let formatted = trimmed
    .replace(/MULTI_TF/gi, 'MULTI-TF')
    .replace(/TF_REALISM/gi, 'TF REALISM')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If the input was all caps, retain clean uppercase phrasing
  if (trimmed === trimmed.toUpperCase() && /^[A-Z0-9_\-\s]+$/.test(trimmed)) {
    return formatted.toUpperCase();
  }

  return formatted;
}

/**
 * Format strategy names cleanly (e.g., handles embedded tags like "[TOP TRADE] Trend Continuation")
 */
export function formatStrategy(strategy?: string | null): string {
  if (!strategy) return 'Multi-Confluence Strategy';
  return formatLabel(strategy);
}

/**
 * Format rank tier labels with optional star symbol
 */
export function formatRankTier(tier?: string | null, includeStar = false): string {
  if (!tier) return '';
  const formatted = formatLabel(tier);
  if (includeStar && (tier === 'BEST_TRADE' || tier === 'SECOND_BEST' || tier === 'TOP_TRADE')) {
    return `★ ${formatted}`;
  }
  return formatted;
}

/**
 * Format status badges (e.g. TP1_HIT -> TP1 HIT)
 */
export function formatStatus(status?: string | null): string {
  if (!status) return 'ACTIVE';
  return formatLabel(status);
}

/**
 * Format session state string
 */
export function formatSessionState(sessionState?: string | null): string {
  if (!sessionState) return 'MARKET OPEN';
  return formatLabel(sessionState);
}

/**
 * Format data provider names
 */
export function formatProviderName(provider?: string | null): string {
  if (!provider) return 'Live Feed';
  const lower = provider.toLowerCase();
  if (lower === 'twelvedata') return 'Twelve Data';
  if (lower === 'bitget') return 'Bitget';
  if (lower === 'finnhub') return 'Finnhub';
  if (lower === 'coinbase') return 'Coinbase';
  if (lower === 'binance') return 'Binance';
  return formatLabel(provider);
}
