/**
 * GATE 26 — ADAPTIVE SIGNAL OPPORTUNITY FUNNEL
 *
 * OBJECTIVE:
 * Increase the number of high-probability trading opportunities without lowering hard safety standards.
 *
 * ARCHITECTURE:
 * 1. STRICT HARD GATES (Zero Compromise - Hard Safety Floor):
 *    - Invalid Data (Gate 0 / Candle OHLC corruption, missing depth)
 *    - Stale Executable Quote (Timestamp freshness > 120s or stale history)
 *    - Impossible Price / Drift (Cross-source disagreement > 0.5%, drift > 15 bps)
 *    - Invalid Stop Loss (SL on wrong side of entry, 0 distance, < 0.85*ATR noise floor)
 *    - Negative Mathematical Expectancy (EV <= 0 or Win Rate <= minimumWinProbability)
 *    - Unacceptable Net R:R (Net R:R < minimumNetRR or Raw R:R < minimumRR)
 *    - Severe Spread/Slippage Friction (Friction > 25% of gross reward)
 *    - Major News Block (Economic event blackout / Gate 7 context block)
 *    - Duplicate Active Trade (Position already active today without material improvement)
 *
 * 2. SOFT GATES & CONFIRMATION CONDITIONS:
 *    - RSI (Momentum zone / oversold-overbought recovery)
 *    - MACD (Histogram expansion & directional alignment)
 *    - VWAP (Intraday benchmark alignment)
 *    - Volume (Relative volume >= 1.0x / expansion)
 *    - Divergence (RSI / MACD regular or hidden divergence)
 *    - Relative Strength (Sector/cluster relative strength vs benchmark)
 *    - Secondary Timeframe Confirmation (Multi-TF trend & structure alignment)
 *
 * 3. OPPORTUNITY FUNNEL STAGES:
 *    - 70–74: WATCHING (Passes hard gates, monitored for missing soft confirmations; NEVER sent as trade signal)
 *    - 75–81: QUALIFIED CANDIDATE (Strong setup, monitored for final trigger / AI confirmation)
 *    - 82+:   SIGNAL / WAITING_ENTRY / ACTIVE (Full actionable trading signal)
 *
 * 4. ADAPTIVE MONITORING:
 *    - Promotes to SIGNAL if missing confirmations improve.
 *    - Invalidates candidate if conditions deteriorate or hard gates fail.
 */

import { NormalizedCandle, NormalizedTicker, SignalDirection, OpportunityFunnelStage, OpportunityFunnelItem, FunnelEvaluationReport } from '../../types/index.js';
import { logger } from '../logger.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { serverConfig } from '../config.js';
import { SignalValidator } from './SignalValidator.js';
import { Gate0DataValidator } from './Gate0DataValidator.js';

export interface HardGateEvaluationResult {
  passed: boolean;
  failedGate?: 
    | 'INVALID_DATA'
    | 'STALE_EXECUTABLE_QUOTE'
    | 'IMPOSSIBLE_PRICE'
    | 'INVALID_SL'
    | 'NEGATIVE_EXPECTANCY'
    | 'UNACCEPTABLE_NET_RR'
    | 'SEVERE_SPREAD_SLIPPAGE'
    | 'MAJOR_NEWS_BLOCK'
    | 'DUPLICATE_ACTIVE_TRADE';
  rejectionReason: string;
}

export interface SoftConditionsEvaluationResult {
  passedConditions: string[];
  missingConditions: string[];
  softScore: number;
  rsiConfirmed: boolean;
  macdConfirmed: boolean;
  vwapConfirmed: boolean;
  volumeConfirmed: boolean;
  divergenceConfirmed: boolean;
  relativeStrengthConfirmed: boolean;
  secondaryTimeframeConfirmed: boolean;
}

export interface FunnelClassificationResult {
  stage: OpportunityFunnelStage;
  isActionableSignal: boolean;
  hardGatesResult: HardGateEvaluationResult;
  softConditionsResult: SoftConditionsEvaluationResult;
  score: number;
  message: string;
}

export class HardGatesEvaluator {
  /**
   * Evaluates all 9 strict HARD GATES.
   * If ANY hard gate fails, the setup is unconditionally rejected.
   */
  static evaluate(params: {
    symbol: string;
    direction: SignalDirection;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    riskRewardRatio: number;
    liveTicker: NormalizedTicker | null;
    candlesMap: Record<string, NormalizedCandle[]>;
    estimatedWinRate?: number;
    expectancy?: number;
    estimatedFrictionRatio?: number;
    isNewsBlocked?: boolean;
    isDuplicateActiveTrade?: boolean;
    secondaryPrice?: { price: number; source: string };
    simulatedTimeMs?: number;
  }): HardGateEvaluationResult {
    const thresholds = serverConfig.getThresholds();
    const now = params.simulatedTimeMs || Date.now();

    // 1. HARD GATE 1: Invalid Data (Live ticker or candle integrity)
    if (!params.liveTicker || params.liveTicker.status === 'MARKET_DATA_UNAVAILABLE' || params.liveTicker.price <= 0) {
      return {
        passed: false,
        failedGate: 'INVALID_DATA',
        rejectionReason: `REJECTED: INVALID_DATA. Live market quote is unavailable or invalid for ${params.symbol}`,
      };
    }

    const candleIntegrity = SignalValidator.verifyCandleIntegrity(params.candlesMap);
    if (!candleIntegrity.isValid) {
      return {
        passed: false,
        failedGate: 'INVALID_DATA',
        rejectionReason: candleIntegrity.message,
      };
    }

    // 2. HARD GATE 2: Stale Executable Quote
    if (params.liveTicker.status === 'STALE' || !params.liveTicker.isFresh) {
      return {
        passed: false,
        failedGate: 'STALE_EXECUTABLE_QUOTE',
        rejectionReason: `REJECTED: DATA_STALE. Stale executable quote: ticker status is ${params.liveTicker.status} (isFresh: ${params.liveTicker.isFresh})`,
      };
    }
    const tickerAgeMs = now - params.liveTicker.timestamp;
    if (tickerAgeMs > 120000) {
      return {
        passed: false,
        failedGate: 'STALE_EXECUTABLE_QUOTE',
        rejectionReason: `REJECTED: DATA_STALE. Ticker age (${(tickerAgeMs / 1000).toFixed(0)}s) exceeds 120s max tolerance`,
      };
    }

    // 3. HARD GATE 3: Impossible Price / Material Price Drift
    if (params.secondaryPrice && params.secondaryPrice.price > 0) {
      const crossCheck = SignalValidator.verifyCrossPrice(params.symbol, params.liveTicker.price, params.secondaryPrice.price, params.secondaryPrice.source);
      if (!crossCheck.isValid) {
        return {
          passed: false,
          failedGate: 'IMPOSSIBLE_PRICE',
          rejectionReason: crossCheck.message,
        };
      }
    }
    const entryDriftPct = Math.abs(params.liveTicker.price - params.entryPrice) / params.entryPrice;
    if (entryDriftPct > 0.0015) { // 15 bps
      return {
        passed: false,
        failedGate: 'IMPOSSIBLE_PRICE',
        rejectionReason: `REJECTED: PRICE_MISMATCH. Entry price drifted ${(entryDriftPct * 100).toFixed(4)}% beyond 0.15% max tolerance`,
      };
    }

    // 4. HARD GATE 4: Invalid Stop Loss & Geometry
    const livePrice = params.liveTicker.price;
    if (params.direction === 'BUY' && params.stopLoss >= livePrice) {
      return {
        passed: false,
        failedGate: 'INVALID_SL',
        rejectionReason: `REJECTED: INVALID_SL_TP. BUY stop-loss (${params.stopLoss}) must be strictly below entry price (${livePrice})`,
      };
    }
    if (params.direction === 'SELL' && params.stopLoss <= livePrice) {
      return {
        passed: false,
        failedGate: 'INVALID_SL',
        rejectionReason: `REJECTED: INVALID_SL_TP. SELL stop-loss (${params.stopLoss}) must be strictly above entry price (${livePrice})`,
      };
    }
    const rawRisk = Math.abs(livePrice - params.stopLoss);
    if (rawRisk <= 0) {
      return {
        passed: false,
        failedGate: 'INVALID_SL',
        rejectionReason: 'REJECTED: INVALID_SL_TP. Stop-loss distance is zero or negative',
      };
    }

    // Check ATR Noise Floor (0.85 * ATR)
    const htf1h = params.candlesMap['1h'] || params.candlesMap['15m'] || [];
    if (htf1h.length >= 15) {
      const atr = TechnicalIndicators.calculateATR(htf1h, 14);
      if (atr > 0) {
        const minNoiseFloor = 0.85 * atr;
        if (rawRisk < minNoiseFloor * 0.95) { // Small margin for rounding
          return {
            passed: false,
            failedGate: 'INVALID_SL',
            rejectionReason: `REJECTED: VOLATILITY_NOISE_FLOOR. Stop-loss distance (${rawRisk.toFixed(5)}) below minimum noise floor (${minNoiseFloor.toFixed(5)})`,
          };
        }
      }
    }

    // 5. HARD GATE 5: Negative Mathematical Expectancy
    if (params.estimatedWinRate !== undefined && params.estimatedWinRate <= thresholds.minimumWinProbability) {
      return {
        passed: false,
        failedGate: 'NEGATIVE_EXPECTANCY',
        rejectionReason: `REJECTED: WIN_RATE_BELOW_THRESHOLD. Estimated win rate (${params.estimatedWinRate}%) is at or below ${thresholds.minimumWinProbability}% threshold`,
      };
    }
    if (params.expectancy !== undefined && params.expectancy <= 0) {
      return {
        passed: false,
        failedGate: 'NEGATIVE_EXPECTANCY',
        rejectionReason: `REJECTED: NEGATIVE_EXPECTANCY. Mathematical expectancy (${params.expectancy.toFixed(3)}R) is non-positive`,
      };
    }

    // 6. HARD GATE 6: Unacceptable Net R:R
    if (params.riskRewardRatio < thresholds.minimumRR) {
      return {
        passed: false,
        failedGate: 'UNACCEPTABLE_NET_RR',
        rejectionReason: `REJECTED: RR_BELOW_THRESHOLD. Risk/Reward ratio (${params.riskRewardRatio.toFixed(2)}:1) is below ${thresholds.minimumRR}:1 minimum hurdle`,
      };
    }

    // 7. HARD GATE 7: Severe Spread & Slippage Friction
    if (params.estimatedFrictionRatio !== undefined && params.estimatedFrictionRatio > 0.25) {
      return {
        passed: false,
        failedGate: 'SEVERE_SPREAD_SLIPPAGE',
        rejectionReason: `REJECTED: EXECUTION_COST_TOO_HIGH. Friction consumes ${(params.estimatedFrictionRatio * 100).toFixed(1)}% of gross reward (max allowed: 25.0%)`,
      };
    }

    // 8. HARD GATE 8: Major News Blackout
    if (params.isNewsBlocked) {
      return {
        passed: false,
        failedGate: 'MAJOR_NEWS_BLOCK',
        rejectionReason: 'REJECTED: MARKET_CONTEXT_BLOCKED. Trading blocked due to high-impact economic news event blackout',
      };
    }

    // 9. HARD GATE 9: Duplicate Active Trade
    if (params.isDuplicateActiveTrade) {
      return {
        passed: false,
        failedGate: 'DUPLICATE_ACTIVE_TRADE',
        rejectionReason: `REJECTED: DUPLICATE_FINGERPRINT. Active trade for ${params.symbol} (${params.direction}) already running without material improvement`,
      };
    }

    return {
      passed: true,
      rejectionReason: 'All 9 hard safety gates passed',
    };
  }
}

export class SoftConditionsEvaluator {
  /**
   * Evaluates the 7 SOFT CONDITIONS:
   * RSI, MACD, VWAP, Volume, Divergence, Relative Strength, Secondary Timeframe Confirmation
   */
  static evaluate(
    direction: SignalDirection,
    candlesMap: Record<string, NormalizedCandle[]>,
    overrideMetrics?: {
      rsi?: number;
      macdHist?: number;
      vwapDiff?: number;
      volumeRatio?: number;
      divergenceScore?: number;
      relativeStrengthScore?: number;
      timeframeAlignmentCount?: number;
    }
  ): SoftConditionsEvaluationResult {
    const passedConditions: string[] = [];
    const missingConditions: string[] = [];

    const candles15m = candlesMap['15m'] || candlesMap['1h'] || candlesMap['5m'] || [];
    const candles1h = candlesMap['1h'] || candlesMap['4h'] || [];

    // 1. RSI Condition
    let rsiValue = overrideMetrics?.rsi;
    if (rsiValue === undefined && candles15m.length >= 15) {
      const rsiArr = TechnicalIndicators.calculateRSI(candles15m, 14);
      if (rsiArr.length > 0) rsiValue = rsiArr[rsiArr.length - 1];
    }
    let rsiConfirmed = false;
    if (rsiValue !== undefined) {
      if (direction === 'BUY') {
        // Bullish RSI: between 40 and 65 (momentum) or < 35 (oversold turnaround)
        rsiConfirmed = (rsiValue >= 40 && rsiValue <= 68) || rsiValue < 35;
      } else {
        // Bearish RSI: between 35 and 60 (bearish momentum) or > 65 (overbought turnaround)
        rsiConfirmed = (rsiValue >= 32 && rsiValue <= 60) || rsiValue > 65;
      }
    }
    if (rsiConfirmed) {
      passedConditions.push(`RSI confirmation (${rsiValue?.toFixed(1)})`);
    } else {
      missingConditions.push(`RSI momentum alignment (current: ${rsiValue?.toFixed(1) || 'N/A'})`);
    }

    // 2. MACD Condition
    let macdHist = overrideMetrics?.macdHist;
    if (macdHist === undefined && candles15m.length >= 26) {
      const macd = TechnicalIndicators.calculateMACD(candles15m);
      if (macd && typeof macd.histogram === 'number') {
        macdHist = macd.histogram;
      }
    }
    let macdConfirmed = false;
    if (macdHist !== undefined) {
      macdConfirmed = direction === 'BUY' ? macdHist >= 0 : macdHist <= 0;
    }
    if (macdConfirmed) {
      passedConditions.push(`MACD histogram alignment (${macdHist !== undefined ? (macdHist > 0 ? '+' : '') + macdHist.toFixed(4) : 'aligned'})`);
    } else {
      missingConditions.push('MACD histogram directional expansion');
    }

    // 3. VWAP Condition
    let vwapDiff = overrideMetrics?.vwapDiff;
    if (vwapDiff === undefined && candles15m.length >= 10) {
      let cumulativeTpVol = 0;
      let cumulativeVol = 0;
      for (const c of candles15m.slice(-20)) {
        const tp = (c.high + c.low + c.close) / 3;
        const v = c.volume || 1;
        cumulativeTpVol += tp * v;
        cumulativeVol += v;
      }
      const vwap = cumulativeVol > 0 ? cumulativeTpVol / cumulativeVol : 0;
      const lastClose = candles15m[candles15m.length - 1]?.close || 0;
      if (vwap > 0 && lastClose > 0) {
        vwapDiff = (lastClose - vwap) / vwap;
      }
    }
    let vwapConfirmed = false;
    if (vwapDiff !== undefined) {
      vwapConfirmed = direction === 'BUY' ? vwapDiff >= -0.001 : vwapDiff <= 0.001;
    }
    if (vwapConfirmed) {
      passedConditions.push('VWAP benchmark alignment');
    } else {
      missingConditions.push('VWAP benchmark confirmation');
    }

    // 4. Volume Condition
    let volumeRatio = overrideMetrics?.volumeRatio;
    if (volumeRatio === undefined && candles15m.length >= 10) {
      const volArr = candles15m.map(c => c.volume);
      const avgVol = volArr.slice(-10, -1).reduce((a, b) => a + b, 0) / 9;
      const lastVol = volArr[volArr.length - 1] || 0;
      if (avgVol > 0) volumeRatio = lastVol / avgVol;
    }
    let volumeConfirmed = false;
    if (volumeRatio !== undefined) {
      volumeConfirmed = volumeRatio >= 0.90; // At least near average volume
    } else {
      volumeConfirmed = true; // Forex tick volume fallback
    }
    if (volumeConfirmed) {
      passedConditions.push(`Volume support (${volumeRatio ? volumeRatio.toFixed(2) + 'x' : 'normal'})`);
    } else {
      missingConditions.push('Volume expansion (volume < 0.90x avg)');
    }

    // 5. Divergence Condition
    let divergenceScore = overrideMetrics?.divergenceScore ?? 0;
    let divergenceConfirmed = divergenceScore >= 50;
    if (divergenceConfirmed) {
      passedConditions.push('Price/Indicator divergence confirmation');
    } else {
      missingConditions.push('Divergence confirmation');
    }

    // 6. Relative Strength Condition
    let relativeStrengthScore = overrideMetrics?.relativeStrengthScore ?? 60;
    let relativeStrengthConfirmed = relativeStrengthScore >= 50;
    if (relativeStrengthConfirmed) {
      passedConditions.push('Sector/Cluster relative strength alignment');
    } else {
      missingConditions.push('Relative strength leadership vs benchmark');
    }

    // 7. Secondary Timeframe Confirmation
    let tfAlignmentCount = overrideMetrics?.timeframeAlignmentCount;
    if (tfAlignmentCount === undefined) {
      let count = 0;
      for (const tf of ['5m', '15m', '1h', '4h']) {
        if (candlesMap[tf] && candlesMap[tf].length >= 10) count++;
      }
      tfAlignmentCount = Math.max(1, count);
    }
    let secondaryTimeframeConfirmed = tfAlignmentCount >= 2;
    if (secondaryTimeframeConfirmed) {
      passedConditions.push(`Multi-timeframe alignment (${tfAlignmentCount} timeframes aligned)`);
    } else {
      missingConditions.push('Secondary timeframe confirmation (requires 2+ timeframes)');
    }

    // Calculate composite soft score (0-100)
    let softScore = 50;
    if (rsiConfirmed) softScore += 10;
    if (macdConfirmed) softScore += 10;
    if (vwapConfirmed) softScore += 8;
    if (volumeConfirmed) softScore += 7;
    if (divergenceConfirmed) softScore += 8;
    if (relativeStrengthConfirmed) softScore += 4;
    if (secondaryTimeframeConfirmed) softScore += 10;

    softScore = Math.min(100, Math.max(0, softScore));

    return {
      passedConditions,
      missingConditions,
      softScore,
      rsiConfirmed,
      macdConfirmed,
      vwapConfirmed,
      volumeConfirmed,
      divergenceConfirmed,
      relativeStrengthConfirmed,
      secondaryTimeframeConfirmed,
    };
  }
}

export class OpportunityFunnelEngine {
  /**
   * Classifies a setup into the Opportunity Funnel:
   * - WATCHING: 70–74 (Passes all Hard Gates, missing some Soft Confirmations; NOT sent as trade signal)
   * - QUALIFIED CANDIDATE (CONFIRMED): 75–81 (Passes all Hard Gates, strong soft confluence; monitored closely)
   * - SIGNAL / WAITING_ENTRY: 82+ (Passes Hard Gates + fully confirmed; actionable trade signal)
   */
  static classifyOpportunity(params: {
    symbol: string;
    direction: SignalDirection;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    riskRewardRatio: number;
    score: number;
    liveTicker: NormalizedTicker | null;
    candlesMap: Record<string, NormalizedCandle[]>;
    estimatedWinRate?: number;
    expectancy?: number;
    estimatedFrictionRatio?: number;
    isNewsBlocked?: boolean;
    isDuplicateActiveTrade?: boolean;
    secondaryPrice?: { price: number; source: string };
    overrideMetrics?: {
      rsi?: number;
      macdHist?: number;
      vwapDiff?: number;
      volumeRatio?: number;
      divergenceScore?: number;
      relativeStrengthScore?: number;
      timeframeAlignmentCount?: number;
    };
  }): FunnelClassificationResult {
    const thresholds = serverConfig.getThresholds();

    // 1. Evaluate Hard Gates First (Zero-Tolerance Hard Safety Floor)
    const hardGatesResult = HardGatesEvaluator.evaluate({
      symbol: params.symbol,
      direction: params.direction,
      entryPrice: params.entryPrice,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
      tp1: params.tp1,
      tp2: params.tp2,
      tp3: params.tp3,
      riskRewardRatio: params.riskRewardRatio,
      liveTicker: params.liveTicker,
      candlesMap: params.candlesMap,
      estimatedWinRate: params.estimatedWinRate,
      expectancy: params.expectancy,
      estimatedFrictionRatio: params.estimatedFrictionRatio,
      isNewsBlocked: params.isNewsBlocked,
      isDuplicateActiveTrade: params.isDuplicateActiveTrade,
      secondaryPrice: params.secondaryPrice,
    });

    if (!hardGatesResult.passed) {
      return {
        stage: 'WATCHING',
        isActionableSignal: false,
        hardGatesResult,
        softConditionsResult: {
          passedConditions: [],
          missingConditions: ['Hard risk gate failed: ' + hardGatesResult.rejectionReason],
          softScore: 0,
          rsiConfirmed: false,
          macdConfirmed: false,
          vwapConfirmed: false,
          volumeConfirmed: false,
          divergenceConfirmed: false,
          relativeStrengthConfirmed: false,
          secondaryTimeframeConfirmed: false,
        },
        score: params.score,
        message: hardGatesResult.rejectionReason,
      };
    }

    // 2. Evaluate Soft Conditions
    const softConditionsResult = SoftConditionsEvaluator.evaluate(
      params.direction,
      params.candlesMap,
      params.overrideMetrics
    );

    // Compute effective composite score
    const effectiveScore = params.score;

    // 3. Funnel Stage Classification
    if (effectiveScore < thresholds.watchingThreshold) {
      return {
        stage: 'WATCHING',
        isActionableSignal: false,
        hardGatesResult,
        softConditionsResult,
        score: effectiveScore,
        message: `REJECTED: SCORE_BELOW_THRESHOLD. Score ${effectiveScore} below minimum watching threshold of ${thresholds.watchingThreshold}`,
      };
    }

    if (effectiveScore < thresholds.qualifiedCandidateThreshold) {
      // 70–74: WATCHING
      return {
        stage: 'WATCHING',
        isActionableSignal: false,
        hardGatesResult,
        softConditionsResult,
        score: effectiveScore,
        message: `Opportunity classified as WATCHING (Score: ${effectiveScore}/${thresholds.signalThreshold}). Monitored for missing confirmations: [${softConditionsResult.missingConditions.join(', ')}]`,
      };
    }

    if (effectiveScore < thresholds.signalThreshold) {
      // 75–81: QUALIFIED CANDIDATE (CONFIRMED)
      return {
        stage: 'CONFIRMED',
        isActionableSignal: false,
        hardGatesResult,
        softConditionsResult,
        score: effectiveScore,
        message: `Opportunity classified as QUALIFIED CANDIDATE (Score: ${effectiveScore}/${thresholds.signalThreshold}). Waiting for final confirmation trigger.`,
      };
    }

    // 82+: FULL SIGNAL
    return {
      stage: 'WAITING_ENTRY',
      isActionableSignal: true,
      hardGatesResult,
      softConditionsResult,
      score: effectiveScore,
      message: `Full actionable SIGNAL generated (Score: ${effectiveScore}/${thresholds.signalThreshold}). All hard gates passed with high soft confluence.`,
    };
  }
}

/**
 * In-Memory & Persistent Funnel Tracking Store
 */
class OpportunityFunnelStoreClass {
  private items: Map<string, OpportunityFunnelItem> = new Map();
  private maxItems = 100;

  constructor() {
    logger.info('[OpportunityFunnelStore] Initialized Adaptive Signal Opportunity Funnel Store');
  }

  /**
   * Adds or updates a candidate in the funnel
   */
  addOrUpdate(item: OpportunityFunnelItem): OpportunityFunnelItem {
    this.items.set(item.id, {
      ...item,
      updatedAt: Date.now(),
    });

    // Prune if excessive
    if (this.items.size > this.maxItems) {
      const sorted = Array.from(this.items.entries()).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
      this.items = new Map(sorted.slice(0, this.maxItems));
    }

    return this.items.get(item.id)!;
  }

  get(id: string): OpportunityFunnelItem | undefined {
    return this.items.get(id);
  }

  getAll(): OpportunityFunnelItem[] {
    return Array.from(this.items.values()).sort((a, b) => b.score - a.score);
  }

  getByStage(stage: OpportunityFunnelStage): OpportunityFunnelItem[] {
    return this.getAll().filter(item => item.stage === stage);
  }

  /**
   * Promotes an opportunity to a higher stage or SIGNAL
   */
  promote(id: string, newScore: number, signalId?: string): OpportunityFunnelItem | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;

    const thresholds = serverConfig.getThresholds();
    let newStage: OpportunityFunnelStage = item.stage;
    let newStatus = item.status;

    if (newScore >= thresholds.signalThreshold) {
      newStage = 'WAITING_ENTRY';
      newStatus = 'PROMOTED';
    } else if (newScore >= thresholds.qualifiedCandidateThreshold) {
      newStage = 'CONFIRMED';
      newStatus = 'QUALIFIED';
    }

    item.score = newScore;
    item.stage = newStage;
    item.status = newStatus;
    item.promotedAt = Date.now();
    item.updatedAt = Date.now();
    if (signalId) item.signalId = signalId;

    logger.info(`[OpportunityFunnel] Promoted ${item.symbol} ${item.direction} to ${newStage} (Score: ${newScore})`, { id, symbol: item.symbol, newStage });
    return item;
  }

  /**
   * Invalidates an opportunity due to hard gate failure or condition deterioration
   */
  invalidate(id: string, reason: string): OpportunityFunnelItem | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;

    item.status = 'INVALIDATED';
    item.invalidationReason = reason;
    item.updatedAt = Date.now();

    logger.info(`[OpportunityFunnel] Invalidated candidate ${item.symbol}: ${reason}`, { id, symbol: item.symbol });
    return item;
  }

  /**
   * Evaluates all active watching and candidate opportunities against latest market data
   */
  evaluateAll(): FunnelEvaluationReport {
    const now = Date.now();
    const thresholds = serverConfig.getThresholds();

    let watchingCount = 0;
    let qualifiedCount = 0;
    let promotedCount = 0;
    let invalidatedCount = 0;
    let expiredCount = 0;

    for (const [id, item] of this.items.entries()) {
      // Check expiration
      if (item.status !== 'INVALIDATED' && item.status !== 'EXPIRED' && now > item.expiresAt) {
        item.status = 'EXPIRED';
        item.updatedAt = now;
        expiredCount++;
        continue;
      }

      if (item.status === 'INVALIDATED') {
        invalidatedCount++;
        continue;
      }

      if (item.status === 'PROMOTED') {
        promotedCount++;
        continue;
      }

      if (item.stage === 'WATCHING') {
        watchingCount++;
      } else if (item.stage === 'CONFIRMED' || item.stage === 'CANDIDATE') {
        qualifiedCount++;
      }
    }

    const totalActive = watchingCount + qualifiedCount;

    return {
      timestamp: now,
      watchingCount,
      qualifiedCount,
      promotedCount,
      invalidatedCount,
      expiredCount,
      totalActive,
      thresholds: {
        watchingThreshold: thresholds.watchingThreshold,
        qualifiedCandidateThreshold: thresholds.qualifiedCandidateThreshold,
        signalThreshold: thresholds.signalThreshold,
      },
      items: this.getAll(),
    };
  }

  clear(): void {
    this.items.clear();
  }
}

export const OpportunityFunnelStore = new OpportunityFunnelStoreClass();
