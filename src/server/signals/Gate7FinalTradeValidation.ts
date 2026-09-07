/**
 * GATE 7 — FINAL TRADE VALIDATION
 *
 * MANDATORY HARD GATES (13 GATES):
 * 1. Fresh market data
 * 2. Valid current entry price
 * 3. Valid symbol
 * 4. Valid market/session status
 * 5. Valid direction
 * 6. Valid ATR/volatility data
 * 7. Valid stop-loss
 * 8. Valid take-profit levels
 * 9. Minimum acceptable R:R
 * 10. No stale price
 * 11. No duplicate/conflicting active signal
 * 12. No cooldown violation
 * 13. No provider/data integrity failure
 *
 * STRICT EXECUTION POLICY:
 * - If ANY hard gate fails -> candidate is NOT tradeable -> DO NOT generate a signal.
 * - Numerical score NEVER overrides hard gates. (A score of 95 with invalid entry data is strictly rejected).
 * - ACCEPTANCE CRITERIA: FINAL_SCORE >= 70 AND ALL HARD_GATES = PASS.
 * - Only then classify the candidate as TRADEABLE.
 */

import { NormalizedCandle, NormalizedTicker, SignalDirection } from '../../types/index.js';
import { serverConfig } from '../config.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { CooldownManager } from './CooldownManager.js';
import { SignalFingerprint } from './SignalFingerprint.js';
import { MarketStructureDetector } from './MarketStructureDetector.js';
import { RiskRewardCalculator, logRrRejectionDiagnostic } from './RiskRewardCalculator.js';
import { logger } from '../logger.js';

export interface HardGateEvaluation {
  id: number;
  code: string;
  name: string;
  passed: boolean;
  reason?: string;
  data?: any;
}

export interface Gate7ValidationContext {
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  riskRewardRatio: number;
  netRiskRewardRatio?: number;
  score: number;
  candlesMap: Record<string, NormalizedCandle[]>;
  liveTicker: NormalizedTicker | null;
  atr?: number;
  secondaryPrice?: { price: number; source: string };
  primaryStrategy?: string;
  marketRegime?: string;
  activeSignals?: Map<string, any>;
  minimumRRThreshold?: number;
  minimumScoreThreshold?: number;
  currentTimeMs?: number;
}

export interface Gate7ValidationResult {
  isTradeable: boolean;
  allHardGatesPassed: boolean;
  finalScore: number;
  scoreRequirementPassed: boolean;
  hardGates: HardGateEvaluation[];
  failedGatesCount: number;
  failedGateCodes: string[];
  primaryRejectionReason?: string;
  reasons: string[];
  validatedAt: number;
  adjustedEntryPrice?: number;
  adjustedStopLoss?: number;
  adjustedTakeProfit?: number;
  adjustedNetRR?: number;
}

export class Gate7FinalTradeValidation {
  public static get REQUIRED_MIN_SCORE(): number {
    const config = serverConfig?.getConfig?.();
    const threshold = config?.thresholds?.signalThreshold;
    if (typeof threshold !== 'number' || isNaN(threshold) || threshold <= 0) {
      throw new Error(`[Gate 7 Configuration Error] Authoritative signalThreshold is unavailable or invalid: ${threshold}`);
    }
    return threshold;
  }
  public static get DEFAULT_MIN_RR(): number { return serverConfig.getConfig().thresholds.minimumRR; }
  public static readonly MAX_DATA_AGE_SECONDS = 180; // 3 minutes

  /**
   * Performs exhaustive evaluation of all 13 Mandatory Hard Gates.
   */
  public static validateCandidate(ctx: Gate7ValidationContext): Gate7ValidationResult {
    const now = ctx.currentTimeMs || Date.now();
    const hardGates: HardGateEvaluation[] = [];
    const reasons: string[] = [];
    const minRR = ctx.minimumRRThreshold ?? this.DEFAULT_MIN_RR;
    const minScore = ctx.minimumScoreThreshold ?? this.REQUIRED_MIN_SCORE;

    const classification = SymbolNormalizer.getAssetClassification(ctx.symbol);

    // =========================================================================
    // GATE 1: FRESH MARKET DATA
    // =========================================================================
    let g1Passed = true;
    let g1Reason: string | undefined;

    if (!ctx.liveTicker || !ctx.liveTicker.timestamp) {
      g1Passed = false;
      g1Reason = 'Live ticker object or timestamp is missing.';
    } else {
      const tickerAgeSec = (now - ctx.liveTicker.timestamp) / 1000;
      if (tickerAgeSec > this.MAX_DATA_AGE_SECONDS) {
        g1Passed = false;
        g1Reason = `Live ticker is stale (${tickerAgeSec.toFixed(1)}s old > ${this.MAX_DATA_AGE_SECONDS}s max limit).`;
      } else if (ctx.liveTicker.status === 'STALE' || ctx.liveTicker.status === 'MARKET_DATA_UNAVAILABLE') {
        g1Passed = false;
        g1Reason = `Live ticker status is ${ctx.liveTicker.status}.`;
      }
    }
    hardGates.push({
      id: 1,
      code: 'FRESH_MARKET_DATA',
      name: 'Fresh Market Data',
      passed: g1Passed,
      reason: g1Reason,
      data: { tickerTimestamp: ctx.liveTicker?.timestamp, maxAge: this.MAX_DATA_AGE_SECONDS },
    });
    if (!g1Passed) reasons.push(`[Gate 1 Fresh Market Data] ${g1Reason}`);

    // =========================================================================
    // GATE 2: VALID CURRENT ENTRY PRICE
    // =========================================================================
    let g2Passed = true;
    let g2Reason: string | undefined;

    if (
      ctx.entryPrice === null ||
      ctx.entryPrice === undefined ||
      isNaN(ctx.entryPrice) ||
      !isFinite(ctx.entryPrice) ||
      ctx.entryPrice <= 0
    ) {
      g2Passed = false;
      g2Reason = `Entry price is invalid (${ctx.entryPrice}).`;
    } else if (ctx.liveTicker && ctx.liveTicker.price > 0) {
      const priceDrift = Math.abs(ctx.entryPrice - ctx.liveTicker.price) / ctx.liveTicker.price;
      if (priceDrift > 0.0035) { // 0.35% max drift tolerance
        g2Passed = false;
        g2Reason = `Entry price (${ctx.entryPrice}) drifted ${(priceDrift * 100).toFixed(3)}% from live price (${ctx.liveTicker.price}).`;
      }
    }
    hardGates.push({
      id: 2,
      code: 'VALID_CURRENT_ENTRY_PRICE',
      name: 'Valid Current Entry Price',
      passed: g2Passed,
      reason: g2Reason,
      data: { entryPrice: ctx.entryPrice, livePrice: ctx.liveTicker?.price },
    });
    if (!g2Passed) reasons.push(`[Gate 2 Valid Entry Price] ${g2Reason}`);

    // =========================================================================
    // GATE 3: VALID SYMBOL
    // =========================================================================
    let g3Passed = true;
    let g3Reason: string | undefined;

    if (!ctx.symbol || typeof ctx.symbol !== 'string' || ctx.symbol.trim().length < 2) {
      g3Passed = false;
      g3Reason = `Symbol string is empty or invalid ('${ctx.symbol}').`;
    } else if (classification === 'UNKNOWN' || SymbolNormalizer.normalizeAppSymbol(ctx.symbol).length < 2) {
      g3Passed = false;
      g3Reason = `Symbol '${ctx.symbol}' is not recognized as a valid tradeable asset.`;
    }
    hardGates.push({
      id: 3,
      code: 'VALID_SYMBOL',
      name: 'Valid Symbol',
      passed: g3Passed,
      reason: g3Reason,
      data: { symbol: ctx.symbol, assetClass: classification },
    });
    if (!g3Passed) reasons.push(`[Gate 3 Valid Symbol] ${g3Reason}`);

    // =========================================================================
    // GATE 4: VALID MARKET / SESSION STATUS
    // =========================================================================
    let g4Passed = true;
    let g4Reason: string | undefined;

    const currentUtcDay = new Date(now).getUTCDay(); // 0 = Sun, 6 = Sat
    const currentUtcHour = new Date(now).getUTCHours();
    const currentUtcMin = new Date(now).getUTCMinutes();
    const decimalHour = currentUtcHour + currentUtcMin / 60;

    if (classification === 'FOREX') {
      // Forex market closes Friday 21:00 UTC (5pm EST) and reopens Sunday 21:00 UTC (5pm EST)
      const isForexWeekend =
        (currentUtcDay === 5 && decimalHour >= 21.0) ||
        currentUtcDay === 6 ||
        (currentUtcDay === 0 && decimalHour < 21.0);

      if (isForexWeekend) {
        g4Passed = false;
        g4Reason = 'Forex weekend closure. Market is closed until Sunday 21:00 UTC.';
      }
    } else if (classification === 'STOCK') {
      // US Stock Market standard trading hours check
      const isStockWeekend = currentUtcDay === 0 || currentUtcDay === 6;
      if (isStockWeekend) {
        g4Passed = false;
        g4Reason = 'Stock market is closed on weekends.';
      }
    }
    hardGates.push({
      id: 4,
      code: 'VALID_MARKET_SESSION_STATUS',
      name: 'Valid Market/Session Status',
      passed: g4Passed,
      reason: g4Reason,
      data: { classification, currentUtcDay, decimalHour },
    });
    if (!g4Passed) reasons.push(`[Gate 4 Market Session Status] ${g4Reason}`);

    // =========================================================================
    // GATE 5: VALID DIRECTION
    // =========================================================================
    let g5Passed = true;
    let g5Reason: string | undefined;

    if (ctx.direction !== 'BUY' && ctx.direction !== 'SELL') {
      g5Passed = false;
      g5Reason = `Invalid directional bias '${ctx.direction}'. Must be BUY or SELL.`;
    }
    hardGates.push({
      id: 5,
      code: 'VALID_DIRECTION',
      name: 'Valid Direction',
      passed: g5Passed,
      reason: g5Reason,
      data: { direction: ctx.direction },
    });
    if (!g5Passed) reasons.push(`[Gate 5 Valid Direction] ${g5Reason}`);

    // =========================================================================
    // GATE 6: VALID ATR / VOLATILITY DATA
    // =========================================================================
    let g6Passed = true;
    let g6Reason: string | undefined;

    const atr = ctx.atr ?? 0;
    if (isNaN(atr) || !isFinite(atr) || atr <= 0) {
      g6Passed = false;
      g6Reason = `ATR is invalid or zero (${atr}).`;
    } else if (ctx.entryPrice > 0) {
      const atrPct = (atr / ctx.entryPrice) * 100;
      if (atrPct < 0.01) {
        g6Passed = false;
        g6Reason = `ATR volatility is collapsed / dead (${atrPct.toFixed(4)}% of price).`;
      } else if (atrPct > 20.0) {
        g6Passed = false;
        g6Reason = `ATR volatility is extreme / erratic (${atrPct.toFixed(2)}% of price).`;
      }
    }
    hardGates.push({
      id: 6,
      code: 'VALID_ATR_VOLATILITY',
      name: 'Valid ATR/Volatility Data',
      passed: g6Passed,
      reason: g6Reason,
      data: { atr, entryPrice: ctx.entryPrice },
    });
    if (!g6Passed) reasons.push(`[Gate 6 Valid ATR Volatility] ${g6Reason}`);

    // =========================================================================
    // GATE 7: VALID STOP-LOSS
    // =========================================================================
    let g7Passed = true;
    let g7Reason: string | undefined;

    if (
      ctx.stopLoss === null ||
      ctx.stopLoss === undefined ||
      isNaN(ctx.stopLoss) ||
      !isFinite(ctx.stopLoss) ||
      ctx.stopLoss <= 0
    ) {
      g7Passed = false;
      g7Reason = `Stop-loss price is invalid (${ctx.stopLoss}).`;
    } else if (ctx.direction === 'BUY' && ctx.stopLoss >= ctx.entryPrice) {
      g7Passed = false;
      g7Reason = `Stop-loss for BUY (${ctx.stopLoss}) must be strictly below entry price (${ctx.entryPrice}).`;
    } else if (ctx.direction === 'SELL' && ctx.stopLoss <= ctx.entryPrice) {
      g7Passed = false;
      g7Reason = `Stop-loss for SELL (${ctx.stopLoss}) must be strictly above entry price (${ctx.entryPrice}).`;
    } else if (ctx.entryPrice > 0) {
      const slDistPct = (Math.abs(ctx.entryPrice - ctx.stopLoss) / ctx.entryPrice) * 100;
      if (slDistPct < 0.02) {
        g7Passed = false;
        g7Reason = `Stop-loss distance is practically zero (${slDistPct.toFixed(4)}%).`;
      } else if (slDistPct > 25.0) {
        g7Passed = false;
        g7Reason = `Stop-loss distance is excessively wide (${slDistPct.toFixed(2)}%).`;
      }
    }
    hardGates.push({
      id: 7,
      code: 'VALID_STOP_LOSS',
      name: 'Valid Stop-Loss',
      passed: g7Passed,
      reason: g7Reason,
      data: { stopLoss: ctx.stopLoss, entryPrice: ctx.entryPrice, direction: ctx.direction },
    });
    if (!g7Passed) reasons.push(`[Gate 7 Valid Stop-Loss] ${g7Reason}`);

    // =========================================================================
    // GATE 8: VALID TAKE-PROFIT LEVELS
    // =========================================================================
    let g8Passed = true;
    let g8Reason: string | undefined;

    const tp1 = ctx.tp1 ?? ctx.takeProfit;
    const tp2 = ctx.tp2 ?? (ctx.direction === 'BUY' ? tp1 * 1.01 : tp1 * 0.99);
    const tp3 = ctx.tp3 ?? (ctx.direction === 'BUY' ? tp2 * 1.01 : tp2 * 0.99);

    if (isNaN(tp1) || !isFinite(tp1) || tp1 <= 0) {
      g8Passed = false;
      g8Reason = `Take-profit 1 is invalid (${tp1}).`;
    } else if (ctx.direction === 'BUY') {
      if (tp1 <= ctx.entryPrice) {
        g8Passed = false;
        g8Reason = `Take-profit 1 (${tp1}) must be strictly above entry price (${ctx.entryPrice}) for BUY.`;
      } else if (tp2 <= tp1 || tp3 <= tp2) {
        g8Passed = false;
        g8Reason = `Take-profit levels must be ascending for BUY (TP1: ${tp1}, TP2: ${tp2}, TP3: ${tp3}).`;
      }
    } else if (ctx.direction === 'SELL') {
      if (tp1 >= ctx.entryPrice) {
        g8Passed = false;
        g8Reason = `Take-profit 1 (${tp1}) must be strictly below entry price (${ctx.entryPrice}) for SELL.`;
      } else if (tp2 >= tp1 || tp3 >= tp2) {
        g8Passed = false;
        g8Reason = `Take-profit levels must be descending for SELL (TP1: ${tp1}, TP2: ${tp2}, TP3: ${tp3}).`;
      }
    }
    hardGates.push({
      id: 8,
      code: 'VALID_TAKE_PROFIT_LEVELS',
      name: 'Valid Take-Profit Levels',
      passed: g8Passed,
      reason: g8Reason,
      data: { tp1, tp2, tp3, entryPrice: ctx.entryPrice, direction: ctx.direction },
    });
    if (!g8Passed) reasons.push(`[Gate 8 Valid Take-Profit Levels] ${g8Reason}`);

    // =========================================================================
    // GATE 9: MINIMUM ACCEPTABLE R:R
    // =========================================================================
    let g9Passed = true;
    let g9Reason: string | undefined;

    
    const canonicalRR = RiskRewardCalculator.calculate(ctx.entryPrice, ctx.stopLoss, tp1, tp2, tp3, ctx.direction, minRR);
    const effectiveRR = canonicalRR.grossRR;

    if (!canonicalRR.isValid || isNaN(effectiveRR) || !isFinite(effectiveRR) || effectiveRR < minRR) {
      g9Passed = false;
      g9Reason = `REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (${effectiveRR.toFixed(2)}:1) is below ${minRR}:1 minimum acceptable GROSS R:R`;
      logRrRejectionDiagnostic({
        symbol: ctx.symbol,
        direction: ctx.direction,
        entryPrice: ctx.entryPrice,
        stopLoss: ctx.stopLoss,
        tp1,
        tp2,
        tp3,
        rejectionReason: g9Reason,
      });
    }

    hardGates.push({
      id: 9,
      code: 'MIN_ACCEPTABLE_RR',
      name: 'Minimum Acceptable R:R',
      passed: g9Passed,
      reason: g9Reason,
      data: { effectiveRR, minRR, calculatedGrossRR: canonicalRR.grossRR, passedViaTp3: canonicalRR.passedViaTp3 },
    });

    if (!g9Passed) reasons.push(`[Gate 9 Minimum Acceptable RR] ${g9Reason}`);

    // =========================================================================
    // GATE 10: NO STALE PRICE
    // =========================================================================
    let g10Passed = true;
    let g10Reason: string | undefined;

    if (ctx.liveTicker) {
      const timeSinceUpdateMs = now - ctx.liveTicker.timestamp;
      if (timeSinceUpdateMs > this.MAX_DATA_AGE_SECONDS * 1000) {
        g10Passed = false;
        g10Reason = `Stale price: No fresh market quote for ${(timeSinceUpdateMs / 1000).toFixed(0)} seconds.`;
      }
    }
    hardGates.push({
      id: 10,
      code: 'NO_STALE_PRICE',
      name: 'No Stale Price',
      passed: g10Passed,
      reason: g10Reason,
      data: { tickerTimestamp: ctx.liveTicker?.timestamp },
    });
    if (!g10Passed) reasons.push(`[Gate 10 No Stale Price] ${g10Reason}`);

    // =========================================================================
    // GATE 11: NO DUPLICATE / CONFLICTING ACTIVE SIGNAL
    // =========================================================================
    let g11Passed = true;
    let g11Reason: string | undefined;

    if (ctx.activeSignals && ctx.activeSignals.has(ctx.symbol)) {
      const activeSig = ctx.activeSignals.get(ctx.symbol);
      if (activeSig && activeSig.status !== 'EXPIRED' && activeSig.status !== 'CLOSED' && activeSig.status !== 'CANCELLED') {
        if (activeSig.direction !== ctx.direction) {
          g11Passed = false;
          g11Reason = `Conflicting active signal exists on ${ctx.symbol} (Active: ${activeSig.direction}, New: ${ctx.direction}).`;
        }
      }
    }

    // Fingerprint duplicate check
    const fp = SignalFingerprint.generateFingerprint({
      symbol: ctx.symbol,
      direction: ctx.direction,
      entryPrice: ctx.entryPrice,
      timeframe: 'Multi-TF Realism Setup',
      primaryStrategy: ctx.primaryStrategy || 'Multi-Timeframe Trend Confluence',
      atr,
    });
    const fpCheck = SignalFingerprint.checkDuplicateFingerprint(fp);
    if (fpCheck.isDuplicate) {
      g11Passed = false;
      g11Reason = `Duplicate signal fingerprint match [${fp}]. Identical setup emitted within 24h.`;
    }

    hardGates.push({
      id: 11,
      code: 'NO_DUPLICATE_ACTIVE_SIGNAL',
      name: 'No Duplicate/Conflicting Active Signal',
      passed: g11Passed,
      reason: g11Reason,
      data: { fp, isDuplicate: fpCheck.isDuplicate },
    });
    if (!g11Passed) reasons.push(`[Gate 11 No Duplicate/Conflict] ${g11Reason}`);

    // =========================================================================
    // GATE 12: NO COOLDOWN VIOLATION
    // =========================================================================
    let g12Passed = true;
    let g12Reason: string | undefined;

    const assetCooldown = CooldownManager.isAssetInCooldown(ctx.symbol);
    if (assetCooldown.inCooldown) {
      const structCheck = MarketStructureDetector.hasStructureMateriallyChanged({
        symbol: ctx.symbol,
        currentEntry: ctx.entryPrice,
        currentRegime: ctx.marketRegime,
        currentDirection: ctx.direction,
        currentAtr: atr,
        candles1h: ctx.candlesMap['1h'],
      });

      if (!structCheck.hasChanged) {
        g12Passed = false;
        g12Reason = `Asset is in cooldown (${assetCooldown.remainingMinutes}m remaining) with no material structure change: ${structCheck.reason}`;
      }
    }

    if (ctx.primaryStrategy) {
      const stratCooldown = CooldownManager.isStrategyInCooldown(ctx.symbol, ctx.primaryStrategy);
      if (stratCooldown.inCooldown) {
        g12Passed = false;
        g12Reason = `Strategy [${ctx.primaryStrategy}] is in cooldown on ${ctx.symbol} (${stratCooldown.remainingMinutes}m remaining).`;
      }
    }

    hardGates.push({
      id: 12,
      code: 'NO_COOLDOWN_VIOLATION',
      name: 'No Cooldown Violation',
      passed: g12Passed,
      reason: g12Reason,
      data: { assetInCooldown: assetCooldown.inCooldown },
    });
    if (!g12Passed) reasons.push(`[Gate 12 No Cooldown Violation] ${g12Reason}`);

    // =========================================================================
    // GATE 13: NO PROVIDER / DATA INTEGRITY FAILURE
    // =========================================================================
    let g13Passed = true;
    let g13Reason: string | undefined;

    // Check OHLC integrity across all provided candles
    for (const [tf, candles] of Object.entries(ctx.candlesMap)) {
      if (!candles || candles.length === 0) continue;
      for (const c of candles.slice(-10)) {
        if (c.high < c.low || c.high < c.open || c.high < c.close || c.low > c.open || c.low > c.close) {
          g13Passed = false;
          g13Reason = `Malformed candle on ${tf}: High (${c.high}) < Low (${c.low}) or inconsistent OHLC bounds.`;
          break;
        }
        if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
          g13Passed = false;
          g13Reason = `Non-positive candle price value on ${tf}.`;
          break;
        }
      }
      if (!g13Passed) break;
    }

    // Cross-source price mismatch check
    if (ctx.secondaryPrice && ctx.secondaryPrice.price > 0 && ctx.entryPrice > 0) {
      const discrepancyPct = Math.abs(ctx.entryPrice - ctx.secondaryPrice.price) / ctx.entryPrice;
      if (discrepancyPct > 0.015) { // 1.5% max cross-source tolerance
        g13Passed = false;
        g13Reason = `Cross-source price discrepancy (${(discrepancyPct * 100).toFixed(2)}%) between Primary and ${ctx.secondaryPrice.source}.`;
      }
    }

    hardGates.push({
      id: 13,
      code: 'NO_DATA_INTEGRITY_FAILURE',
      name: 'No Provider/Data Integrity Failure',
      passed: g13Passed,
      reason: g13Reason,
      data: { secondarySource: ctx.secondaryPrice?.source },
    });
    if (!g13Passed) reasons.push(`[Gate 13 Data Integrity] ${g13Reason}`);

    // =========================================================================
    // FINAL TRADEABILITY DETERMINATION
    // =========================================================================
    const failedGates = hardGates.filter(g => !g.passed);
    const allHardGatesPassed = failedGates.length === 0;
    const scoreRequirementPassed = ctx.score >= minScore;

    // CRITICAL: Numerical score NEVER overrides hard gates!
    const isTradeable = allHardGatesPassed && scoreRequirementPassed;

    let primaryRejectionReason: string | undefined;
    if (!allHardGatesPassed) {
      primaryRejectionReason = `Failed ${failedGates.length} Hard Gates: ${failedGates.map(g => g.name).join(', ')}`;
    } else if (!scoreRequirementPassed) {
      primaryRejectionReason = `Composite signal score ${ctx.score}/100 is below the minimum required threshold of ${minScore}/100`;
    }

    if (!isTradeable) {
      logger.info(
        `[Gate 7 Validation Result] ${ctx.symbol} (${ctx.direction}) -> NOT TRADEABLE. Passed Gates: ${hardGates.length - failedGates.length}/13, Score: ${ctx.score}/${minScore}. Reason: ${primaryRejectionReason}`
      );
    } else {
      logger.info(
        `[Gate 7 Validation Result] ${ctx.symbol} (${ctx.direction}) -> TRADEABLE! All 13 Hard Gates Passed. Score: ${ctx.score} >= ${minScore}.`
      );
    }

    return {
      isTradeable,
      allHardGatesPassed,
      finalScore: ctx.score,
      scoreRequirementPassed,
      hardGates,
      failedGatesCount: failedGates.length,
      failedGateCodes: failedGates.map(g => g.code),
      primaryRejectionReason,
      reasons,
      validatedAt: now,
      adjustedEntryPrice: ctx.entryPrice,
      adjustedStopLoss: ctx.stopLoss,
      adjustedTakeProfit: tp1,
      adjustedNetRR: canonicalRR.grossRR,
    };
  }
}
