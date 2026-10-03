/**
 * FREQTRADE DYNAMIC EXIT ENGINE
 *
 * Adapts dynamic stoploss, minimal ROI table, and trailing exit concepts
 * from Freqtrade (https://github.com/freqtrade/freqtrade) for adaptive exit management.
 *
 * KEY FEATURES:
 * 1. DYNAMIC STOPLOSS: Adaptive SL based on ATR volatility, trend strength (ADX), and trade progression.
 * 2. MINIMAL ROI TABLE: Time-decayed profit targets (e.g., 0-15m: 4.0%, 15-30m: 2.5%, 30-60m: 1.5%, >60m: 0.8%).
 * 3. DYNAMIC TRAILING EXIT: Offset-triggered trailing stop loss based on favorable price excursion.
 * 4. STRUCTURAL SAFETY BOUNDS: Never widens structural stop loss beyond initial risk and never violates price order.
 */

import { SignalDirection } from '../../types/index.js';
import { logger } from '../logger.js';

export interface MinimalRoiTable {
  [minutesElapsed: number]: number; // Ratio e.g. { 0: 0.04, 15: 0.025, 30: 0.015, 60: 0.008 }
}

export interface FreqtradeExitConfig {
  minimalRoi: MinimalRoiTable;
  stoplossRatio: number;               // Default -0.02 (-2%)
  trailingStop: boolean;
  trailingStopPositive: number;       // Offset e.g. 0.01 (1%)
  trailingStopPositiveOffset: number; // Activation threshold e.g. 0.015 (1.5%)
  useCustomStoploss: boolean;
  breakevenProfitR: number;            // Lock breakeven after +1.0R gain
}

export interface FreqtradeExitEvaluationInput {
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  atr?: number;
  adx?: number;
  trendState?: string;
  holdingTimeMinutes?: number;
  highestProfitPct?: number;           // Max favorable excursion % achieved
  currentTimeMs?: number;
  config?: Partial<FreqtradeExitConfig>;
}

export interface FreqtradeExitEvaluationResult {
  symbol: string;
  direction: SignalDirection;
  recommendedStopLoss: number;
  recommendedTakeProfit: number;
  tp1: number;
  tp2: number;
  tp3: number;
  roiExitTriggered: boolean;
  roiExitReason?: string;
  trailingStopActive: boolean;
  trailingStopPrice?: number;
  dynamicStopLossDistance: number;
  exitUrgency: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL_EXIT';
  exitSignalReason?: string;
  details: {
    minimalRoiThresholdPct: number;
    currentProfitPct: number;
    highestProfitPct: number;
    atrMultiplier: number;
    adaptiveTpMultiplier: number;
    trailingOffsetReached: boolean;
    breakevenLocked: boolean;
  };
}

export class FreqtradeExitEngine {
  public static readonly DEFAULT_CONFIG: FreqtradeExitConfig = {
    minimalRoi: {
      0: 0.040,   // 4.0% immediate profit requirement for 0m
      15: 0.025,  // 2.5% requirement after 15m
      30: 0.015,  // 1.5% requirement after 30m
      60: 0.008,  // 0.8% requirement after 60m
    },
    stoplossRatio: -0.02,
    trailingStop: true,
    trailingStopPositive: 0.010,       // Trail by 1.0%
    trailingStopPositiveOffset: 0.015, // Activate trailing once +1.5% is reached
    useCustomStoploss: true,
    breakevenProfitR: 1.0,             // Move stop loss to entry + buffer when price hits 1.0R gain
  };

  /**
   * Evaluates dynamic exit parameters, ROI thresholds, and trailing stop levels for a trade position or candidate.
   */
  public static evaluateExit(input: FreqtradeExitEvaluationInput): FreqtradeExitEvaluationResult {
    const cfg: FreqtradeExitConfig = {
      ...this.DEFAULT_CONFIG,
      ...input.config,
      minimalRoi: { ...this.DEFAULT_CONFIG.minimalRoi, ...(input.config?.minimalRoi || {}) },
    };

    const {
      symbol,
      direction,
      entryPrice,
      currentPrice,
      stopLoss,
      takeProfit,
      tp1: rawTp1,
      tp2: rawTp2,
      tp3: rawTp3,
      atr: inputAtr,
      holdingTimeMinutes = 0,
    } = input;

    const isBuy = direction === 'BUY';
    const isSell = direction === 'SELL';

    const atr = inputAtr && inputAtr > 0 ? inputAtr : (entryPrice * 0.01);
    const riskDistance = Math.abs(entryPrice - stopLoss);

    // Calculate current profit percentage and profit in R-multiples
    let currentProfitPct = 0;
    if (entryPrice > 0) {
      currentProfitPct = isBuy
        ? (currentPrice - entryPrice) / entryPrice
        : (entryPrice - currentPrice) / entryPrice;
    }

    const currentProfitR = riskDistance > 0 ? (currentProfitPct * entryPrice) / riskDistance : 0;
    const highestProfitPct = Math.max(currentProfitPct, input.highestProfitPct || 0);

    // 1. Minimal ROI Table Evaluation (Freqtrade ROI exit logic)
    const requiredRoiPct = this.getMinimalRoiThreshold(cfg.minimalRoi, holdingTimeMinutes);
    const roiExitTriggered = currentProfitPct >= requiredRoiPct && currentProfitPct > 0;
    const roiExitReason = roiExitTriggered
      ? `FREQTRADE_ROI_TARGET_HIT: Holding time ${holdingTimeMinutes}m profit (${(currentProfitPct * 100).toFixed(2)}%) exceeded ROI threshold (${(requiredRoiPct * 100).toFixed(2)}%)`
      : undefined;

    // 2. Dynamic Trailing Stop Evaluation (Freqtrade trailing stop logic)
    let trailingStopActive = false;
    let trailingStopPrice: number | undefined = undefined;
    const trailingOffsetReached = highestProfitPct >= cfg.trailingStopPositiveOffset;

    if (cfg.trailingStop && trailingOffsetReached) {
      trailingStopActive = true;
      const trailDistancePct = cfg.trailingStopPositive;
      const trailDistancePrice = Math.max(currentPrice * trailDistancePct, atr * 0.8);

      if (isBuy) {
        trailingStopPrice = currentPrice - trailDistancePrice;
      } else {
        trailingStopPrice = currentPrice + trailDistancePrice;
      }
    }

    // 3. Custom Dynamic Breakeven & Progression Adjustment
    let recommendedStopLoss = stopLoss;
    let breakevenLocked = false;

    if (cfg.useCustomStoploss) {
      if (currentProfitR >= cfg.breakevenProfitR) {
        // Lock breakeven + minor friction buffer (0.1% buffer)
        const buffer = entryPrice * 0.001;
        const breakevenSl = isBuy ? entryPrice + buffer : entryPrice - buffer;

        if (isBuy && breakevenSl > recommendedStopLoss) {
          recommendedStopLoss = breakevenSl;
          breakevenLocked = true;
        } else if (isSell && breakevenSl < recommendedStopLoss) {
          recommendedStopLoss = breakevenSl;
          breakevenLocked = true;
        }
      }

      // If trailing stop is active and tighter than current recommended SL, advance SL
      if (trailingStopActive && trailingStopPrice !== undefined) {
        if (isBuy && trailingStopPrice > recommendedStopLoss) {
          recommendedStopLoss = trailingStopPrice;
        } else if (isSell && trailingStopPrice < recommendedStopLoss) {
          recommendedStopLoss = trailingStopPrice;
        }
      }
    }

    // Ensure structural safety constraint: NEVER widen stop loss beyond initial structural SL
    if (isBuy) {
      recommendedStopLoss = Math.min(entryPrice * 0.999, Math.max(stopLoss, recommendedStopLoss));
    } else {
      recommendedStopLoss = Math.max(entryPrice * 1.001, Math.min(stopLoss, recommendedStopLoss));
    }

    // 4. Adaptive Take Profit Levels
    const baseTp1 = rawTp1 ?? (isBuy ? entryPrice + riskDistance * 1.2 : entryPrice - riskDistance * 1.2);
    const baseTp2 = rawTp2 ?? takeProfit ?? (isBuy ? entryPrice + riskDistance * 1.8 : entryPrice - riskDistance * 1.8);
    const baseTp3 = rawTp3 ?? (isBuy ? entryPrice + riskDistance * 2.5 : entryPrice - riskDistance * 2.5);

    // Adaptive volatility & trend multiplier for TP targets
    const adx = input.adx ?? 25;
    const trendBoost = adx > 35 ? 1.15 : (adx < 18 ? 0.90 : 1.0);
    const atrMultiplier = Number((atr / entryPrice).toFixed(4));
    const adaptiveTpMultiplier = Number((1.0 * trendBoost).toFixed(2));

    const tp1 = isBuy ? Math.max(baseTp1, entryPrice + atr * 1.2) : Math.min(baseTp1, entryPrice - atr * 1.2);
    const tp2 = isBuy ? Math.max(baseTp2, tp1 + atr * 1.0) : Math.min(baseTp2, tp1 - atr * 1.0);
    const tp3 = isBuy ? Math.max(baseTp3, tp2 + atr * 1.2) : Math.min(baseTp3, tp2 - atr * 1.2);
    const recommendedTakeProfit = tp2;

    // 5. Exit Urgency Determination
    let exitUrgency: FreqtradeExitEvaluationResult['exitUrgency'] = 'NONE';
    let exitSignalReason: string | undefined = undefined;

    if (roiExitTriggered) {
      exitUrgency = 'HIGH';
      exitSignalReason = roiExitReason;
    } else if (trailingStopActive && ((isBuy && currentPrice <= trailingStopPrice!) || (isSell && currentPrice >= trailingStopPrice!))) {
      exitUrgency = 'CRITICAL_EXIT';
      exitSignalReason = `FREQTRADE_TRAILING_STOP_HIT: Current price (${currentPrice}) hit dynamic trailing stop (${trailingStopPrice?.toFixed(4)})`;
    } else if (holdingTimeMinutes > 120 && currentProfitPct < -0.01) {
      exitUrgency = 'MEDIUM';
      exitSignalReason = `FREQTRADE_STALE_POSITION_EXIT: Position held ${holdingTimeMinutes}m with negative profit (${(currentProfitPct * 100).toFixed(2)}%)`;
    }

    const dynamicStopLossDistance = Math.abs(entryPrice - recommendedStopLoss);

    return {
      symbol,
      direction,
      recommendedStopLoss: Number(recommendedStopLoss.toFixed(6)),
      recommendedTakeProfit: Number(recommendedTakeProfit.toFixed(6)),
      tp1: Number(tp1.toFixed(6)),
      tp2: Number(tp2.toFixed(6)),
      tp3: Number(tp3.toFixed(6)),
      roiExitTriggered,
      roiExitReason,
      trailingStopActive,
      trailingStopPrice: trailingStopPrice ? Number(trailingStopPrice.toFixed(6)) : undefined,
      dynamicStopLossDistance: Number(dynamicStopLossDistance.toFixed(6)),
      exitUrgency,
      exitSignalReason,
      details: {
        minimalRoiThresholdPct: Number((requiredRoiPct * 100).toFixed(2)),
        currentProfitPct: Number((currentProfitPct * 100).toFixed(2)),
        highestProfitPct: Number((highestProfitPct * 100).toFixed(2)),
        atrMultiplier,
        adaptiveTpMultiplier,
        trailingOffsetReached,
        breakevenLocked,
      },
    };
  }

  /**
   * Helper to compute adaptive levels for a new or candidate signal.
   */
  public static calculateAdaptiveLevels(input: {
    entryPrice: number;
    direction: SignalDirection;
    atr: number;
    adx?: number;
    trendStrength?: number;
    baseSl: number;
    baseTp1: number;
    baseTp2: number;
    baseTp3: number;
  }): {
    adaptiveSl: number;
    adaptiveTp1: number;
    adaptiveTp2: number;
    adaptiveTp3: number;
    primaryTp: number;
  } {
    const { entryPrice, direction, atr, adx = 25, baseSl, baseTp1, baseTp2, baseTp3 } = input;
    const isBuy = direction === 'BUY';

    const volatilityFactor = Math.max(0.8, Math.min(2.0, (atr / (entryPrice * 0.01))));
    const trendFactor = adx >= 30 ? 1.12 : (adx <= 18 ? 0.90 : 1.0);

    // Initial dynamic SL must not widen risk beyond structural SL
    let adaptiveSl = baseSl;
    if (isBuy) {
      const dynamicSlDist = Math.max(Math.abs(entryPrice - baseSl), atr * 1.2 * volatilityFactor);
      adaptiveSl = Math.max(baseSl, entryPrice - dynamicSlDist);
    } else {
      const dynamicSlDist = Math.max(Math.abs(baseSl - entryPrice), atr * 1.2 * volatilityFactor);
      adaptiveSl = Math.min(baseSl, entryPrice + dynamicSlDist);
    }

    const adaptiveTp1 = isBuy ? Math.max(baseTp1, entryPrice + atr * 1.5 * trendFactor) : Math.min(baseTp1, entryPrice - atr * 1.5 * trendFactor);
    const adaptiveTp2 = isBuy ? Math.max(baseTp2, adaptiveTp1 + atr * 1.2 * trendFactor) : Math.min(baseTp2, adaptiveTp1 - atr * 1.2 * trendFactor);
    const adaptiveTp3 = isBuy ? Math.max(baseTp3, adaptiveTp2 + atr * 1.5 * trendFactor) : Math.min(baseTp3, adaptiveTp2 - atr * 1.5 * trendFactor);

    return {
      adaptiveSl: Number(adaptiveSl.toFixed(6)),
      adaptiveTp1: Number(adaptiveTp1.toFixed(6)),
      adaptiveTp2: Number(adaptiveTp2.toFixed(6)),
      adaptiveTp3: Number(adaptiveTp3.toFixed(6)),
      primaryTp: Number(adaptiveTp2.toFixed(6)),
    };
  }

  /**
   * Evaluates the Minimal ROI threshold required for a given holding time in minutes.
   */
  private static getMinimalRoiThreshold(table: MinimalRoiTable, minutesElapsed: number): number {
    const times = Object.keys(table)
      .map(Number)
      .sort((a, b) => b - a); // Descending

    for (const t of times) {
      if (minutesElapsed >= t) {
        return table[t];
      }
    }
    return 0.040; // Default fallback
  }
}
