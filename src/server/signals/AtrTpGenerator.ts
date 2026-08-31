import { SignalDirection } from '../../types/index.js';
import { getDynamicPrecision } from '../../utils/formatters.js';

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export interface GuardrailRange {
  minPct: number;
  maxPct: number;
}

export interface AssetClassGuardrails {
  tp1: GuardrailRange;
  tp2: GuardrailRange;
  tp3: GuardrailRange;
}

export const ASSET_CLASS_GUARDRAILS: Record<string, AssetClassGuardrails> = {
  CRYPTO: {
    tp1: { minPct: 0.50, maxPct: 2.00 },
    tp2: { minPct: 1.00, maxPct: 4.00 },
    tp3: { minPct: 1.50, maxPct: 6.00 },
  },
  FOREX: {
    tp1: { minPct: 0.15, maxPct: 0.80 },
    tp2: { minPct: 0.30, maxPct: 1.50 },
    tp3: { minPct: 0.50, maxPct: 2.50 },
  },
  STOCKS: {
    tp1: { minPct: 0.30, maxPct: 1.20 },
    tp2: { minPct: 0.60, maxPct: 2.50 },
    tp3: { minPct: 1.00, maxPct: 4.00 },
  },
  COMMODITIES: {
    tp1: { minPct: 0.30, maxPct: 1.20 },
    tp2: { minPct: 0.60, maxPct: 2.50 },
    tp3: { minPct: 1.00, maxPct: 4.00 },
  },
  INDICES: {
    tp1: { minPct: 0.30, maxPct: 1.20 },
    tp2: { minPct: 0.60, maxPct: 2.50 },
    tp3: { minPct: 1.00, maxPct: 4.00 },
  },
  DEFAULT: {
    tp1: { minPct: 0.20, maxPct: 2.50 },
    tp2: { minPct: 0.50, maxPct: 5.00 },
    tp3: { minPct: 0.80, maxPct: 8.00 },
  },
};

export interface AtrTpInput {
  direction: SignalDirection;
  entryPrice: number;
  atr: number;
  precision?: number;
  isAggressive?: boolean;
  volatilityRegime?: VolatilityRegime;
  assetClass?: string;
  customGuardrails?: Partial<AssetClassGuardrails>;
}

export interface AtrTpResult {
  tp1: number;
  tp2: number;
  tp3: number;
  takeProfit: number;
  multipliersUsed: { m1: number; m2: number; m3: number };
  volatilityRegime: VolatilityRegime;
  isAggressive: boolean;
  isValid: boolean;
  rejectionReason?: string;
}

export class AtrTpGenerator {
  public static applyGuardrail(rawTp: number, range: GuardrailRange, entryPrice: number, isBuy: boolean): number {
    const rawDist = Math.abs(rawTp - entryPrice);
    const maxDist = entryPrice * (range.maxPct / 100);
    const minDist = entryPrice * (range.minPct / 100);
    // Safety ceiling: cap at maxDist (maxPct). Safety floor: ensure at least minDist (minPct) if rawDist is smaller.
    // If rawDist is larger than minDist (volatility/risk-derived target), keep rawDist (do not move closer).
    let dist = Math.min(rawDist, maxDist);
    if (dist < minDist) {
      dist = minDist;
    }
    return isBuy ? entryPrice + dist : entryPrice - dist;
  }

  /**
   * Determine volatility regime based on ATR % relative to price if not explicitly provided.
   */
  public static detectVolatilityRegime(atr: number, entryPrice: number, assetClass?: string): VolatilityRegime {
    if (!entryPrice || entryPrice <= 0 || !atr || atr <= 0) return 'NORMAL';
    const atrPct = (atr / entryPrice) * 100;

    const normalizedAsset = (assetClass || '').toUpperCase();
    if (normalizedAsset === 'FOREX') {
      if (atrPct < 0.15) return 'LOW';
      if (atrPct <= 0.40) return 'NORMAL';
      if (atrPct <= 0.80) return 'HIGH';
      return 'EXTREME';
    }

    // Default & Crypto regime thresholds
    if (atrPct < 0.80) return 'LOW';
    if (atrPct <= 2.50) return 'NORMAL';
    if (atrPct <= 5.00) return 'HIGH';
    return 'EXTREME';
  }

  /**
   * Derive decimal precision if not provided.
   */
  public static getPrecision(entryPrice: number, symbol?: string): number {
    return getDynamicPrecision(entryPrice, symbol);
  }

  /**
   * Primary ATR-Based TP Generation
   */
  public static generate(input: AtrTpInput): AtrTpResult {
    const {
      direction,
      entryPrice,
      atr,
      isAggressive = false,
      assetClass = 'DEFAULT',
      customGuardrails,
    } = input;

    if (!entryPrice || entryPrice <= 0 || isNaN(entryPrice)) {
      return {
        tp1: 0,
        tp2: 0,
        tp3: 0,
        takeProfit: 0,
        multipliersUsed: { m1: 0, m2: 0, m3: 0 },
        volatilityRegime: 'NORMAL',
        isAggressive,
        isValid: false,
        rejectionReason: 'Invalid entry price (entryPrice <= 0 or NaN)',
      };
    }

    const precision = input.precision ?? this.getPrecision(entryPrice);
    const cleanAtr = Math.max(0, atr || 0);

    // If ATR is zero/missing, use a small fallback distance (0.5%)
    const effectiveAtr = cleanAtr > 0 ? cleanAtr : entryPrice * 0.005;

    // Detect or use provided Volatility Regime
    const volatilityRegime = input.volatilityRegime ?? this.detectVolatilityRegime(effectiveAtr, entryPrice, assetClass);

    // 1. Determine ATR Multipliers
    let m1 = 1.0;
    let m2 = 1.7;
    let m3 = 2.5;

    if (isAggressive) {
      // Aggressive Mode for strong trend/momentum
      m1 = 1.2;
      m2 = 1.9;
      m3 = 2.8;
    }

    // Adjust multipliers by Volatility Regime
    if (volatilityRegime === 'HIGH') {
      // High volatility permits wider TP2/TP3
      if (isAggressive) {
        m1 = 1.2;
        m2 = 2.0;
        m3 = 3.0;
      } else {
        m1 = 1.1;
        m2 = 1.8;
        m3 = 2.8;
      }
    } else if (volatilityRegime === 'EXTREME') {
      // Extreme volatility uses baseline multipliers to avoid absurd distances,
      // and relies on percentage guardrails to enforce safety.
      m1 = 1.0;
      m2 = 1.7;
      m3 = 2.5;
    }

    // 2. Primary Formula Calculation
    const isBuy = direction === 'BUY';
    let rawTp1 = isBuy ? entryPrice + (effectiveAtr * m1) : entryPrice - (effectiveAtr * m1);
    let rawTp2 = isBuy ? entryPrice + (effectiveAtr * m2) : entryPrice - (effectiveAtr * m2);
    let rawTp3 = isBuy ? entryPrice + (effectiveAtr * m3) : entryPrice - (effectiveAtr * m3);

    // 3. Percentage Guardrails (Safety Boundaries)
    const normalizedAsset = assetClass.toUpperCase();
    const baseGuardrails = ASSET_CLASS_GUARDRAILS[normalizedAsset] || ASSET_CLASS_GUARDRAILS.DEFAULT;
    const guardrails: AssetClassGuardrails = {
      tp1: { ...baseGuardrails.tp1, ...customGuardrails?.tp1 },
      tp2: { ...baseGuardrails.tp2, ...customGuardrails?.tp2 },
      tp3: { ...baseGuardrails.tp3, ...customGuardrails?.tp3 },
    };

    const applyGuardrail = (rawTp: number, range: GuardrailRange): number => {
      return AtrTpGenerator.applyGuardrail(rawTp, range, entryPrice, isBuy);
    };

    let tp1Clamped = applyGuardrail(rawTp1, guardrails.tp1);
    let tp2Clamped = applyGuardrail(rawTp2, guardrails.tp2);
    let tp3Clamped = applyGuardrail(rawTp3, guardrails.tp3);

    // Round to specified decimal precision
    let tp1 = Number(tp1Clamped.toFixed(precision));
    let tp2 = Number(tp2Clamped.toFixed(precision));
    let tp3 = Number(tp3Clamped.toFixed(precision));

    // 4. Strict Target Ordering & Distinctness Enforcement
    const minStep = Math.pow(10, -precision);

    if (isBuy) {
      if (tp1 <= entryPrice) {
        tp1 = Number((entryPrice + minStep).toFixed(precision));
      }
      if (tp2 <= tp1) {
        tp2 = Number((tp1 + minStep).toFixed(precision));
      }
      if (tp3 <= tp2) {
        tp3 = Number((tp2 + minStep).toFixed(precision));
      }
    } else {
      if (tp1 >= entryPrice) {
        tp1 = Number((entryPrice - minStep).toFixed(precision));
      }
      if (tp2 >= tp1) {
        tp2 = Number((tp1 - minStep).toFixed(precision));
      }
      if (tp3 >= tp2) {
        tp3 = Number((tp2 - minStep).toFixed(precision));
      }
    }

    // Final Target Ordering Verification
    const isOrdered = isBuy
      ? entryPrice < tp1 && tp1 < tp2 && tp2 < tp3
      : entryPrice > tp1 && tp1 > tp2 && tp2 > tp3;

    // Absolute positivity / sanity guard — negative, zero, or non-finite
    // targets must never be emitted, regardless of ordering.
    const allFiniteAndPositive =
      Number.isFinite(tp1) && tp1 > 0 &&
      Number.isFinite(tp2) && tp2 > 0 &&
      Number.isFinite(tp3) && tp3 > 0;

    if (!allFiniteAndPositive) {
      return {
        tp1, tp2, tp3,
        takeProfit: tp2,
        multipliersUsed: { m1, m2, m3 },
        volatilityRegime,
        isAggressive,
        isValid: false,
        rejectionReason: `Generated take-profit target is non-positive or invalid for ${direction}: entry=${entryPrice}, tp1=${tp1}, tp2=${tp2}, tp3=${tp3}`,
      };
    }

    if (!isOrdered) {
      return {
        tp1,
        tp2,
        tp3,
        takeProfit: tp2,
        multipliersUsed: { m1, m2, m3 },
        volatilityRegime,
        isAggressive,
        isValid: false,
        rejectionReason: `Target ordering check failed for ${direction}: entry=${entryPrice}, tp1=${tp1}, tp2=${tp2}, tp3=${tp3}`,
      };
    }

    return {
      tp1,
      tp2,
      tp3,
      takeProfit: tp2,
      multipliersUsed: { m1, m2, m3 },
      volatilityRegime,
      isAggressive,
      isValid: true,
    };
  }
}
