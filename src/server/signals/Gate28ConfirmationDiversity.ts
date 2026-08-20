/**
 * GATE 28 — INDEPENDENT CONFIRMATION DIVERSITY
 *
 * OBJECTIVE:
 * Prevent multiple correlated indicators (e.g., 5 RSI/MACD variations) from artificially
 * inflating signal confidence.
 *
 * CONFIRMATION CATEGORIES:
 * 1. STRUCTURE    : HH/HL, LH/LL, BOS (Break of Structure), CHOCH (Change of Character), EMA Stack
 * 2. MOMENTUM     : RSI, MACD / Zero-Lag MACD, ROC (Rate of Change), Stochastic
 * 3. VOLATILITY   : ATR / ATR Expansion, Bollinger Band Width / Squeeze
 * 4. LOCATION     : S/R (Support/Resistance), VWAP / Anchored VWAP, Liquidity Pools / Order Blocks
 * 5. PARTICIPATION: Volume Surge, Relative Volume (rVol), Order Flow Delta, Wick Absorption
 * 6. CONTEXT      : Session Alignment (London/NY/Asia), Macro News Sentiment, Asset Correlation
 *
 * QUALITY ARCHITECTURE RULES:
 * - Requires confirmations from AT LEAST 3 DISTINCT CATEGORIES for an executable signal
 *   (e.g., 1 STRUCTURE + 1 MOMENTUM + 1 LOCATION, or 1 STRUCTURE + 1 MOMENTUM + 1 PARTICIPATION).
 * - Multiple indicators from the same category are grouped into a single category confirmation.
 * - Does NOT require every indicator or category.
 * - Non-negotiable quality filter: Rejects signals relying on redundant/correlated indicators.
 */

import { logger } from '../logger.js';

export type ConfirmationCategory =
  | 'STRUCTURE'
  | 'MOMENTUM'
  | 'VOLATILITY'
  | 'LOCATION'
  | 'PARTICIPATION'
  | 'CONTEXT';

export interface CategoryMatch {
  category: ConfirmationCategory;
  indicatorOrPattern: string;
  matchedReason: string;
}

export interface ConfirmationDiversityResult {
  isValid: boolean;
  categoryCount: number;
  presentCategories: ConfirmationCategory[];
  categoryBreakdown: Record<ConfirmationCategory, string[]>;
  diversityScore: number; // 0 - 100
  rejectionReason?: string;
  explanation: string;
}

export class Gate28ConfirmationDiversity {
  private static readonly MIN_REQUIRED_CATEGORIES = 3;

  /**
   * Evaluates confirmation diversity from a list of confluence reasons or technical parameters
   */
  public static evaluate(reasons: string[], technicalData?: any): ConfirmationDiversityResult {
    const categoryBreakdown: Record<ConfirmationCategory, string[]> = {
      STRUCTURE: [],
      MOMENTUM: [],
      VOLATILITY: [],
      LOCATION: [],
      PARTICIPATION: [],
      CONTEXT: [],
    };

    if (Array.isArray(reasons)) {
      for (const reason of reasons) {
        if (!reason || typeof reason !== 'string') continue;
        const upper = reason.toUpperCase();

        // 1. STRUCTURE: HH/HL, LH/LL, BOS, CHOCH, Swing, EMA Stack
        if (
          upper.includes('HH/HL') ||
          upper.includes('LH/LL') ||
          upper.includes('HIGHER HIGH') ||
          upper.includes('HIGHER LOW') ||
          upper.includes('LOWER HIGH') ||
          upper.includes('LOWER LOW') ||
          upper.includes('BOS') ||
          upper.includes('BREAK OF STRUCTURE') ||
          upper.includes('CHOCH') ||
          upper.includes('CHANGE OF CHARACTER') ||
          upper.includes('STRUCTURE') ||
          upper.includes('SWING') ||
          upper.includes('EMA STACK') ||
          upper.includes('EMA9') ||
          upper.includes('EMA21') ||
          upper.includes('EMA50') ||
          upper.includes('TREND CONTINUATION') ||
          upper.includes('BULLISH TREND') ||
          upper.includes('BEARISH TREND')
        ) {
          categoryBreakdown.STRUCTURE.push(reason);
        }

        // 2. MOMENTUM: RSI, MACD, ROC, Stochastic, Momentum
        if (
          upper.includes('RSI') ||
          upper.includes('MACD') ||
          upper.includes('ZERO-LAG') ||
          upper.includes('HISTOGRAM') ||
          upper.includes('ROC') ||
          upper.includes('RATE OF CHANGE') ||
          upper.includes('STOCHASTIC') ||
          upper.includes('MOMENTUM') ||
          upper.includes('ACCELERATION')
        ) {
          categoryBreakdown.MOMENTUM.push(reason);
        }

        // 3. VOLATILITY: ATR, Bollinger, Band Width, Volatility
        if (
          upper.includes('ATR') ||
          upper.includes('BOLLINGER') ||
          upper.includes('BAND') ||
          upper.includes('SQUEEZE') ||
          upper.includes('VOLATILITY') ||
          upper.includes('EXPANSION')
        ) {
          categoryBreakdown.VOLATILITY.push(reason);
        }

        // 4. LOCATION: S/R, VWAP, Liquidity, Order Block, Pivot, Level
        if (
          upper.includes('S/R') ||
          upper.includes('SUPPORT') ||
          upper.includes('RESISTANCE') ||
          upper.includes('VWAP') ||
          upper.includes('ANCHORED VWAP') ||
          upper.includes('LIQUIDITY') ||
          upper.includes('ORDER BLOCK') ||
          upper.includes('KEY LEVEL') ||
          upper.includes('PIVOT') ||
          upper.includes('RUNWAY') ||
          upper.includes('REJECTION BOUNCE') ||
          upper.includes('PROXIMITY')
        ) {
          categoryBreakdown.LOCATION.push(reason);
        }

        // 5. PARTICIPATION: Volume, rVol, Delta, Order Flow, Wick Absorption
        if (
          upper.includes('VOLUME') ||
          upper.includes('RVOL') ||
          upper.includes('DELTA') ||
          upper.includes('ORDER FLOW') ||
          upper.includes('BUYING PRESSURE') ||
          upper.includes('SELLING PRESSURE') ||
          upper.includes('WICK') ||
          upper.includes('ABSORPTION') ||
          upper.includes('SURGE')
        ) {
          categoryBreakdown.PARTICIPATION.push(reason);
        }

        // 6. CONTEXT: Session, News, Sentiment, Correlation, Market Regime
        if (
          upper.includes('SESSION') ||
          upper.includes('LONDON') ||
          upper.includes('NEW YORK') ||
          upper.includes('NY') ||
          upper.includes('ASIA') ||
          upper.includes('NEWS') ||
          upper.includes('SENTIMENT') ||
          upper.includes('CORRELATION') ||
          upper.includes('REGIME') ||
          upper.includes('CROSS-CHECK')
        ) {
          categoryBreakdown.CONTEXT.push(reason);
        }
      }
    }

    // Secondary inspection of technicalData structure if provided
    if (technicalData) {
      if (technicalData.htfEma9 && technicalData.htfEma21 && categoryBreakdown.STRUCTURE.length === 0) {
        categoryBreakdown.STRUCTURE.push('Technical EMA Trend Alignment');
      }
      if (technicalData.htfRsi !== undefined && categoryBreakdown.MOMENTUM.length === 0) {
        categoryBreakdown.MOMENTUM.push(`Technical RSI(${technicalData.htfRsi})`);
      }
      if (technicalData.atr > 0 && categoryBreakdown.VOLATILITY.length === 0) {
        categoryBreakdown.VOLATILITY.push(`ATR Volatility Expansion (${technicalData.atr})`);
      }
    }

    // Determine present categories
    const presentCategories: ConfirmationCategory[] = (
      Object.keys(categoryBreakdown) as ConfirmationCategory[]
    ).filter((cat) => categoryBreakdown[cat].length > 0);

    const categoryCount = presentCategories.length;
    const isValid = categoryCount >= this.MIN_REQUIRED_CATEGORIES;

    // Calculate diversity score (0 to 100)
    // 1 cat = 33, 2 cats = 66, 3 cats = 80, 4 cats = 90, 5+ cats = 100
    let diversityScore = 0;
    if (categoryCount === 1) diversityScore = 33;
    else if (categoryCount === 2) diversityScore = 66;
    else if (categoryCount === 3) diversityScore = 80;
    else if (categoryCount === 4) diversityScore = 90;
    else if (categoryCount >= 5) diversityScore = 100;

    let rejectionReason: string | undefined;
    if (!isValid) {
      rejectionReason = `REJECTED: INSUFFICIENT_CONFIRMATION_DIVERSITY. Setup satisfies only ${categoryCount} independent confirmation category (${presentCategories.join(', ') || 'NONE'}). Minimum ${this.MIN_REQUIRED_CATEGORIES} distinct categories required (e.g., 1 STRUCTURE + 1 MOMENTUM + 1 LOCATION/PARTICIPATION).`;
    }

    const explanation = `Confirmation Diversity: ${categoryCount}/${this.MIN_REQUIRED_CATEGORIES} required categories satisfied [${presentCategories.join(', ')}]. Status: ${isValid ? 'PASSED' : 'REJECTED'}.`;

    logger.info(`[Gate 28 Diversity] ${explanation}`, {
      isValid,
      categoryCount,
      presentCategories,
    });

    return {
      isValid,
      categoryCount,
      presentCategories,
      categoryBreakdown,
      diversityScore,
      rejectionReason,
      explanation,
    };
  }
}
