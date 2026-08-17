/**
 * Market Structure Change Detector
 *
 * Evaluates whether market structure has materially shifted since a prior signal on the same asset.
 * If an asset is in cooldown or has a prior active/recent signal, a new signal is allowed ONLY IF
 * a material market structure change is detected.
 *
 * Criteria for Material Change:
 * 1. Market Regime Transition (e.g. RANGING -> BREAKOUT / TRENDING)
 * 2. Level Displacement: Current entry price moved > 1.5x ATR from previous entry
 * 3. Direction Flip: BUY -> SELL or SELL -> BUY accompanied by structural EMA crossover
 * 4. High/Low Key Level Breakout beyond consolidation boundaries
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { logger } from '../logger.js';

export interface StructureCheckParams {
  symbol: string;
  currentEntry: number;
  currentRegime: string;
  currentDirection: SignalDirection;
  currentAtr: number;
  candles1h?: NormalizedCandle[];
  prevSignal?: {
    entryPrice: number;
    marketRegime?: string;
    direction: SignalDirection;
    timestamp: number;
  };
}

export interface StructureCheckResult {
  hasChanged: boolean;
  reason: string;
  changeType?: 'REGIME_SHIFT' | 'PRICE_DISPLACEMENT' | 'DIRECTION_FLIP' | 'STRUCTURE_BREAK' | 'NO_CHANGE';
}

export class MarketStructureDetector {
  public static hasStructureMateriallyChanged(params: StructureCheckParams): StructureCheckResult {
    const { symbol, currentEntry, currentRegime, currentDirection, currentAtr, prevSignal } = params;

    if (!prevSignal || !prevSignal.entryPrice || prevSignal.entryPrice <= 0) {
      return {
        hasChanged: true,
        reason: 'First signal for asset - no prior structure benchmark exists.',
        changeType: 'REGIME_SHIFT',
      };
    }

    const prevRegime = prevSignal.marketRegime?.toUpperCase() || 'UNKNOWN';
    const curRegime = currentRegime.toUpperCase();

    // 1. Regime Transition Detection
    if (prevRegime !== curRegime && (curRegime === 'BREAKOUT' || curRegime === 'TRENDING' || curRegime === 'HIGH_VOLATILITY')) {
      return {
        hasChanged: true,
        reason: `Regime transitioned from ${prevRegime} to ${curRegime}`,
        changeType: 'REGIME_SHIFT',
      };
    }

    // 2. Direction Shift Detection
    if (prevSignal.direction !== currentDirection) {
      return {
        hasChanged: true,
        reason: `Signal direction inverted from ${prevSignal.direction} to ${currentDirection}`,
        changeType: 'DIRECTION_FLIP',
      };
    }

    // 3. Level Displacement Detection (> 1.5x ATR movement from previous entry price)
    const priceDist = Math.abs(currentEntry - prevSignal.entryPrice);
    const atrHurdle = currentAtr > 0 ? currentAtr * 1.5 : currentEntry * 0.015;

    if (priceDist >= atrHurdle) {
      return {
        hasChanged: true,
        reason: `Significant price level displacement (${priceDist.toFixed(4)} >= 1.5x ATR threshold ${atrHurdle.toFixed(4)}) from previous entry`,
        changeType: 'PRICE_DISPLACEMENT',
      };
    }

    // 4. Structure Breakout Verification using 1H candles if provided
    if (params.candles1h && params.candles1h.length >= 20) {
      const sorted = [...params.candles1h].sort((a, b) => a.timestamp - b.timestamp);
      const recent = sorted.slice(-10);
      const highs = recent.map((c) => c.high);
      const lows = recent.map((c) => c.low);
      const maxHigh = Math.max(...highs);
      const minLow = Math.min(...lows);

      if (currentDirection === 'BUY' && currentEntry > maxHigh) {
        return {
          hasChanged: true,
          reason: `Price broke out above recent 10-bar 1H consolidation high (${maxHigh.toFixed(4)})`,
          changeType: 'STRUCTURE_BREAK',
        };
      }
      if (currentDirection === 'SELL' && currentEntry < minLow) {
        return {
          hasChanged: true,
          reason: `Price broke down below recent 10-bar 1H consolidation low (${minLow.toFixed(4)})`,
          changeType: 'STRUCTURE_BREAK',
        };
      }
    }

    // No material change detected
    return {
      hasChanged: false,
      reason: `No material market structure change on ${symbol}: Price (${currentEntry}) remains within previous entry range (${prevSignal.entryPrice}), regime is unchanged (${curRegime}), and displacement is below 1.5x ATR.`,
      changeType: 'NO_CHANGE',
    };
  }
}
