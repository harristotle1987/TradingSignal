/**
 * CANDIDATE REJECTION AUDIT & TELEMETRY TRACKER
 *
 * Provides granular tracking, categorization, and aggregation of rejection reasons
 * for all candidates evaluated during deep market analysis.
 *
 * Granular Failed Gate Categories:
 * - FRESH_MARKET_DATA: Stale quote, expired cache, missing live ticker, future timestamps
 * - VALID_ENTRY: Invalid entry price, entry drift, price non-positive, overextended entry
 * - TREND: HTF trend disagreement, opposing EMA stack, trend alignment < threshold
 * - MOMENTUM: RSI/MACD opposing bias, momentum disagreement, overbought/oversold reversal
 * - MTF_ALIGNMENT: 15m/1h/4h/5m timeframe contradiction, multi-timeframe score < threshold
 * - LIQUIDITY: Low market liquidity, order book depth insufficiency, slippage risk
 * - VOLUME: Low volume flow, volume profile disagreement, unconfirmed breakout volume
 * - VOLATILITY: Collapsed/dead ATR, erratic/extreme ATR, invalid volatility state
 * - SPREAD: Excessive spread beyond asset maximum threshold
 * - MARKET_STRUCTURE: Structural break, lower lows in uptrend, higher highs in downtrend, S&R block
 * - RR: Risk/Reward ratio below minimum threshold (gross or net)
 * - SL_TP_VALIDITY: Invalid stop-loss distance, invalid take-profit ordering/distance
 * - FINAL_SCORE_BELOW_72: Composite or core tradeability score below final threshold (72)
 * - DUPLICATE_OR_EXISTING_SIGNAL: Duplicate active signal or fingerprint match within 24h
 * - COOLDOWN: Asset or strategy cooldown violation
 * - MARKET_SESSION_STATUS: Closed market session (Forex/Stock weekend or holiday)
 * - DATA_INTEGRITY: Malformed OHLC candles, cross-source price discrepancy
 * - WIN_RATE_BELOW_THRESHOLD: Model estimated win probability below mandatory minimum
 * - NEGATIVE_EXPECTANCY: Mathematical expectancy <= 0
 * - SIGNAL_CAP_EXCEEDED: Daily portfolio signal cap reached
 * - AI_FILTER_REJECTED: External AI validation rejection
 */

import { logger } from '../logger.js';

export enum StandardFailedGate {
  FINAL_SCORE_BELOW_72 = 'FINAL_SCORE_BELOW_72',
  MTF_ALIGNMENT = 'MTF_ALIGNMENT',
  VALID_ENTRY = 'VALID_ENTRY',
  INVALID_ENTRY = 'INVALID_ENTRY',
  FRESH_MARKET_DATA = 'FRESH_MARKET_DATA',
  TREND = 'TREND',
  MOMENTUM = 'MOMENTUM',
  LIQUIDITY = 'LIQUIDITY',
  VOLUME = 'VOLUME',
  VOLATILITY = 'VOLATILITY',
  SPREAD = 'SPREAD',
  MARKET_STRUCTURE = 'MARKET_STRUCTURE',
  RR = 'RR',
  RR_INVALID = 'RR_INVALID',
  SL_TP_VALIDITY = 'SL_TP_VALIDITY',
  DUPLICATE_OR_EXISTING_SIGNAL = 'DUPLICATE_OR_EXISTING_SIGNAL',
  COOLDOWN = 'COOLDOWN',
  MARKET_SESSION_STATUS = 'MARKET_SESSION_STATUS',
  DATA_INTEGRITY = 'DATA_INTEGRITY',
  WIN_RATE_BELOW_THRESHOLD = 'WIN_RATE_BELOW_THRESHOLD',
  NEGATIVE_EXPECTANCY = 'NEGATIVE_EXPECTANCY',
  SIGNAL_CAP_EXCEEDED = 'SIGNAL_CAP_EXCEEDED',
  AI_FILTER_REJECTED = 'AI_FILTER_REJECTED',
}

export interface CandidateRejectionAudit {
  symbol: string;
  direction?: 'BUY' | 'SELL';
  score: number;
  primaryRejectionReason: string;
  failedGates: StandardFailedGate[];
  finalDecision: 'REJECTED' | 'DISPATCHED' | 'WATCHING' | 'QUALIFIED';
  details?: string;
  stage?: string;
}

export class CandidateRejectionTracker {
  private records: Map<string, CandidateRejectionAudit> = new Map();

  /**
   * Records or updates a candidate's evaluation and rejection audit.
   */
  public recordCandidate(audit: CandidateRejectionAudit): void {
    const existing = this.records.get(audit.symbol);
    if (existing) {
      // Merge failed gates without duplicates
      const mergedGates = Array.from(new Set([...existing.failedGates, ...audit.failedGates]));
      this.records.set(audit.symbol, {
        ...existing,
        ...audit,
        score: Math.max(existing.score, audit.score),
        failedGates: mergedGates,
      });
    } else {
      this.records.set(audit.symbol, audit);
    }

    // Output structured console log for candidate rejection audit
    this.logCandidateAudit(this.records.get(audit.symbol)!);
  }

  /**
   * Logs individual candidate evaluation audit to console.
   */
  private logCandidateAudit(audit: CandidateRejectionAudit): void {
    logger.info(
      `[CANDIDATE REJECTION AUDIT]\n` +
      `symbol: ${audit.symbol}${audit.direction ? ` (${audit.direction})` : ''}\n` +
      `score: ${audit.score}\n` +
      `primaryRejectionReason: ${audit.primaryRejectionReason}\n` +
      `failedGates: [${audit.failedGates.map((g) => `"${g}"`).join(', ')}]\n` +
      `finalDecision: ${audit.finalDecision}`
    );
  }

  /**
   * Merges another tracker instance into this one.
   */
  public merge(other: CandidateRejectionTracker): void {
    for (const record of other.getAllRecords()) {
      this.recordCandidate(record);
    }
  }

  /**
   * Returns all recorded candidate rejection audits.
   */
  public getAllRecords(): CandidateRejectionAudit[] {
    return Array.from(this.records.values());
  }

  /**
   * Aggregates scan-wide rejection reason counts.
   * Returns a map of standard failed gate code -> count of candidates failing that gate.
   */
  public getAggregatedRejectionReasons(): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const record of this.records.values()) {
      if (record.finalDecision === 'REJECTED' || record.failedGates.length > 0) {
        for (const gate of record.failedGates) {
          counts[gate] = (counts[gate] || 0) + 1;
        }
      }
    }

    return counts;
  }

  /**
   * Logs a summary of the aggregated scan rejection telemetry.
   */
  public logScanSummary(categoryName = 'Universe Scan'): void {
    const counts = this.getAggregatedRejectionReasons();
    const records = this.getAllRecords();
    const rejectedCount = records.filter((r) => r.finalDecision === 'REJECTED').length;
    const acceptedCount = records.filter((r) => r.finalDecision === 'DISPATCHED' || r.finalDecision === 'QUALIFIED').length;

    const lines: string[] = [
      `================================================================`,
      `[SCAN REJECTION TELEMETRY AUDIT] (${categoryName})`,
      `Total Evaluated: ${records.length} | Rejected: ${rejectedCount} | Dispatched: ${acceptedCount}`,
      `----------------------------------------------------------------`,
    ];

    if (Object.keys(counts).length === 0) {
      lines.push('No gate rejections recorded.');
    } else {
      for (const [gate, count] of Object.entries(counts)) {
        lines.push(`- ${gate}: ${count}`);
      }
    }

    lines.push(`================================================================`);
    logger.info(lines.join('\n'));
  }

  /**
   * Helper to map arbitrary Gate 7 failed gate codes into StandardFailedGate enum.
   */
  public static mapGate7Code(code: string): StandardFailedGate {
    switch (code) {
      case 'FRESH_MARKET_DATA':
      case 'NO_STALE_PRICE':
        return StandardFailedGate.FRESH_MARKET_DATA;
      case 'VALID_CURRENT_ENTRY_PRICE':
        return StandardFailedGate.INVALID_ENTRY;
      case 'VALID_SYMBOL':
      case 'NO_DATA_INTEGRITY_FAILURE':
        return StandardFailedGate.DATA_INTEGRITY;
      case 'VALID_MARKET_SESSION_STATUS':
        return StandardFailedGate.MARKET_SESSION_STATUS;
      case 'VALID_DIRECTION':
        return StandardFailedGate.TREND;
      case 'VALID_ATR_VOLATILITY':
        return StandardFailedGate.VOLATILITY;
      case 'VALID_STOP_LOSS':
      case 'VALID_TAKE_PROFIT_LEVELS':
        return StandardFailedGate.SL_TP_VALIDITY;
      case 'MIN_ACCEPTABLE_RR':
        return StandardFailedGate.RR;
      case 'NO_DUPLICATE_ACTIVE_SIGNAL':
        return StandardFailedGate.DUPLICATE_OR_EXISTING_SIGNAL;
      case 'NO_COOLDOWN_VIOLATION':
        return StandardFailedGate.COOLDOWN;
      default:
        return StandardFailedGate.DATA_INTEGRITY;
    }
  }

  /**
   * Helper to map multiple Gate 7 codes and reasons to an array of standard failed gates.
   */
  public static mapGate7CodesToStandardGates(
    failedGateCodes: string[] = [],
    rejectionReason = '',
    score = 0
  ): StandardFailedGate[] {
    const gates = new Set<StandardFailedGate>();

    for (const code of failedGateCodes) {
      gates.add(CandidateRejectionTracker.mapGate7Code(code));
    }

    const inferred = CandidateRejectionTracker.inferFailedGatesFromReason(rejectionReason, score);
    for (const g of inferred) {
      gates.add(g);
    }

    return Array.from(gates);
  }

  /**
   * Infers StandardFailedGate list from a textual rejection message or reason.
   */
  public static inferFailedGatesFromReason(reason: string, score = 0): StandardFailedGate[] {
    const failedGates = new Set<StandardFailedGate>();
    const lower = (reason || '').toLowerCase();

    if (score < 72 || lower.includes('below') || lower.includes('threshold') || lower.includes('final_score')) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_72);
    }
    if (lower.includes('mtf') || lower.includes('timeframe') || lower.includes('alignment')) {
      failedGates.add(StandardFailedGate.MTF_ALIGNMENT);
    }
    if (lower.includes('stale') || lower.includes('fresh') || lower.includes('candle count') || lower.includes('missing live ticker') || lower.includes('market data')) {
      failedGates.add(StandardFailedGate.FRESH_MARKET_DATA);
    }
    if (lower.includes('entry') || lower.includes('drift') || lower.includes('price level') || lower.includes('invalid entry')) {
      failedGates.add(StandardFailedGate.INVALID_ENTRY);
    }
    if (lower.includes('trend') || lower.includes('ema') || lower.includes('bias') || lower.includes('direction')) {
      failedGates.add(StandardFailedGate.TREND);
    }
    if (lower.includes('momentum') || lower.includes('rsi') || lower.includes('macd') || lower.includes('stochastic')) {
      failedGates.add(StandardFailedGate.MOMENTUM);
    }
    if (lower.includes('liquidity') || lower.includes('depth') || lower.includes('order book')) {
      failedGates.add(StandardFailedGate.LIQUIDITY);
    }
    if (lower.includes('volume') || lower.includes('order flow')) {
      failedGates.add(StandardFailedGate.VOLUME);
    }
    if (lower.includes('volatility') || lower.includes('atr')) {
      failedGates.add(StandardFailedGate.VOLATILITY);
    }
    if (lower.includes('spread') || lower.includes('slippage') || lower.includes('fee')) {
      failedGates.add(StandardFailedGate.SPREAD);
    }
    if (lower.includes('structure') || lower.includes('support') || lower.includes('resistance') || lower.includes('breakout')) {
      failedGates.add(StandardFailedGate.MARKET_STRUCTURE);
    }
    if (lower.includes('rr') || lower.includes('risk') || lower.includes('reward')) {
      failedGates.add(StandardFailedGate.RR);
    }
    if (lower.includes('sl') || lower.includes('tp') || lower.includes('stop loss') || lower.includes('take profit') || lower.includes('distance')) {
      failedGates.add(StandardFailedGate.SL_TP_VALIDITY);
    }
    if (lower.includes('duplicate') || lower.includes('active signal') || lower.includes('existing')) {
      failedGates.add(StandardFailedGate.DUPLICATE_OR_EXISTING_SIGNAL);
    }
    if (lower.includes('cooldown') || lower.includes('cool down')) {
      failedGates.add(StandardFailedGate.COOLDOWN);
    }
    if (lower.includes('win rate') || lower.includes('winrate') || lower.includes('probability')) {
      failedGates.add(StandardFailedGate.WIN_RATE_BELOW_THRESHOLD);
    }
    if (lower.includes('expectancy') || lower.includes('negative')) {
      failedGates.add(StandardFailedGate.NEGATIVE_EXPECTANCY);
    }
    if (lower.includes('cap') || lower.includes('max daily')) {
      failedGates.add(StandardFailedGate.SIGNAL_CAP_EXCEEDED);
    }

    if (failedGates.size === 0) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_72);
    }

    return Array.from(failedGates);
  }

  /**
   * Helper to extract all standard failed gates from a Gate 6 analysis rejection.
   */
  public static extractGate6FailedGates(rej: {
    stoppedAtLayer: number | string;
    rejectionReason?: string;
    layer1?: { disagreements?: string[]; score?: number };
    layer2?: { disagreements?: string[]; score?: number };
    compositeMtfScore?: number;
  }): { primaryReason: string; failedGates: StandardFailedGate[] } {
    const failedGates: Set<StandardFailedGate> = new Set();
    const reasonText = (rej.rejectionReason || '').toLowerCase();
    const l1Disagreements = (rej.layer1?.disagreements || []).map((d) => d.toLowerCase());
    const l2Disagreements = (rej.layer2?.disagreements || []).map((d) => d.toLowerCase());
    const allDisagreements = [...l1Disagreements, ...l2Disagreements, reasonText].join(' ');

    // Always include MTF_ALIGNMENT for Gate 6 failures
    failedGates.add(StandardFailedGate.MTF_ALIGNMENT);

    if (allDisagreements.includes('unavailable') || allDisagreements.includes('stale') || allDisagreements.includes('insufficient candle')) {
      failedGates.add(StandardFailedGate.FRESH_MARKET_DATA);
    }
    if (allDisagreements.includes('trend') || allDisagreements.includes('ema') || allDisagreements.includes('bias') || allDisagreements.includes('opposing')) {
      failedGates.add(StandardFailedGate.TREND);
    }
    if (allDisagreements.includes('momentum') || allDisagreements.includes('rsi') || allDisagreements.includes('macd')) {
      failedGates.add(StandardFailedGate.MOMENTUM);
    }
    if (allDisagreements.includes('volatility') || allDisagreements.includes('atr') || allDisagreements.includes('dead') || allDisagreements.includes('erratic')) {
      failedGates.add(StandardFailedGate.VOLATILITY);
    }
    if (allDisagreements.includes('structure') || allDisagreements.includes('resistance') || allDisagreements.includes('support') || allDisagreements.includes('ceiling') || allDisagreements.includes('floor')) {
      failedGates.add(StandardFailedGate.MARKET_STRUCTURE);
      if (allDisagreements.includes('resistance ceiling') || allDisagreements.includes('support floor')) {
        failedGates.add(StandardFailedGate.INVALID_ENTRY);
      }
    }

    const score = rej.compositeMtfScore ?? rej.layer1?.score ?? 0;
    if (score < 72) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_72);
    }

    let primaryReason = rej.rejectionReason || `Gate 6 Layer ${rej.stoppedAtLayer} MTF Analysis Rejected`;
    if (!primaryReason.startsWith('MTF_ALIGNMENT') && !primaryReason.startsWith('REJECTED')) {
      primaryReason = `MTF_ALIGNMENT: ${primaryReason}`;
    }

    return {
      primaryReason,
      failedGates: Array.from(failedGates),
    };
  }

  /**
   * Helper to extract all standard failed gates from Stage 2 Scoring rejection.
   */
  public static extractScoringFailedGates(
    scoring: any,
    thresholds: { signalThreshold: number; minimumRR: number; minimumScore: number }
  ): { primaryReason: string; failedGates: StandardFailedGate[] } {
    const failedGates: Set<StandardFailedGate> = new Set();
    const reason = scoring.rejectionReason || '';
    const reasonLower = reason.toLowerCase();

    if (scoring.score < thresholds.signalThreshold || scoring.score < 72) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_72);
    }
    if (reasonLower.includes('directional') || reasonLower.includes('trend') || (scoring.factors?.higherTfTrendScore && scoring.factors.higherTfTrendScore < 14)) {
      failedGates.add(StandardFailedGate.TREND);
    }
    if (reasonLower.includes('momentum') || (scoring.factors?.momentumScore && scoring.factors.momentumScore < 10)) {
      failedGates.add(StandardFailedGate.MOMENTUM);
    }
    if (reasonLower.includes('structure') || (scoring.factors?.marketStructureScore && scoring.factors.marketStructureScore < 10)) {
      failedGates.add(StandardFailedGate.MARKET_STRUCTURE);
    }
    if (reasonLower.includes('volume') || (scoring.factors?.volumeOrderFlowScore && scoring.factors.volumeOrderFlowScore < 10)) {
      failedGates.add(StandardFailedGate.VOLUME);
    }
    if (reasonLower.includes('volatility') || reasonLower.includes('atr') || (scoring.factors?.volatilityAtrScore && scoring.factors.volatilityAtrScore < 7)) {
      failedGates.add(StandardFailedGate.VOLATILITY);
    }
    if (reasonLower.includes('context') || reasonLower.includes('session')) {
      failedGates.add(StandardFailedGate.MARKET_SESSION_STATUS);
    }
    if (reasonLower.includes('rr') || (scoring.riskRewardRatio && scoring.riskRewardRatio < thresholds.minimumRR)) {
      failedGates.add(StandardFailedGate.RR);
    }
    if (scoring.timeframeAlignmentRatio !== undefined && scoring.timeframeAlignmentRatio < 0.7) {
      failedGates.add(StandardFailedGate.MTF_ALIGNMENT);
    }

    if (failedGates.size === 0) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_72);
    }

    return {
      primaryReason: reason || 'Scoring criteria not satisfied',
      failedGates: Array.from(failedGates),
    };
  }

  /**
   * Helper to extract all standard failed gates from Gate 8 Tradeability Evaluation.
   */
  public static extractGate8FailedGates(
    gate8Eval: { finalScore: number; rejectionReason?: string; factors?: Record<string, number> },
    threshold = 72
  ): { primaryReason: string; failedGates: StandardFailedGate[] } {
    const failedGates: Set<StandardFailedGate> = new Set();

    if (gate8Eval.finalScore < threshold) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_72);
    }

    const factors = gate8Eval.factors || {};
    if (factors.higherTfTrendScore !== undefined && factors.higherTfTrendScore < 14) {
      failedGates.add(StandardFailedGate.TREND);
    }
    if (factors.mtfConfluenceScore !== undefined && factors.mtfConfluenceScore < 11) {
      failedGates.add(StandardFailedGate.MTF_ALIGNMENT);
    }
    if (factors.momentumScore !== undefined && factors.momentumScore < 10) {
      failedGates.add(StandardFailedGate.MOMENTUM);
    }
    if (factors.marketStructureScore !== undefined && factors.marketStructureScore < 10) {
      failedGates.add(StandardFailedGate.MARKET_STRUCTURE);
    }
    if (factors.volumeOrderFlowScore !== undefined && factors.volumeOrderFlowScore < 10) {
      failedGates.add(StandardFailedGate.VOLUME);
    }
    if (factors.volatilityAtrScore !== undefined && factors.volatilityAtrScore < 7) {
      failedGates.add(StandardFailedGate.VOLATILITY);
    }
    if (factors.entryQualityScore !== undefined && factors.entryQualityScore < 7) {
      failedGates.add(StandardFailedGate.INVALID_ENTRY);
    }
    if (factors.riskRewardScore !== undefined && factors.riskRewardScore < 3.5) {
      failedGates.add(StandardFailedGate.RR);
    }

    return {
      primaryReason: gate8Eval.rejectionReason || `FINAL_SCORE_BELOW_72: Core score (${gate8Eval.finalScore}/100) below required threshold of ${threshold}`,
      failedGates: Array.from(failedGates),
    };
  }
}
