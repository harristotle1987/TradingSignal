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
 * - FINAL_SCORE_BELOW_THRESHOLD: Composite or core tradeability score below final threshold
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
import { serverConfig } from '../config.js';

export enum StandardFailedGate {
  FINAL_SCORE_UNREACHABLE = 'FINAL_SCORE_UNREACHABLE',
  FINAL_SCORE_BELOW_THRESHOLD = 'FINAL_SCORE_BELOW_THRESHOLD',
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
  scoreBeforeGate6?: number;
  maximumPossibleScoreAfterRemainingAnalysis?: number;
  scoreAfterGate6?: number;
  finalScore?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  grossRR?: number;
  effectiveGrossRR?: number;
  primaryRR?: number;
  tp1RR?: number;
  tp2RR?: number;
  tp3RR?: number;
  statusText?: string;
  rejectionSummary?: string;
  timestamp?: number;
  isQualifiedRejected?: boolean;
  factors?: any;
  tpDiagnostics?: any;
  everReachedThreshold?: boolean;
}

export class CandidateRejectionTracker {
  private records: Map<string, CandidateRejectionAudit> = new Map();

  /**
   * Formats a short human-readable summary for rejection reasons.
   */
  public static formatHumanReadableSummary(
    reason: string,
    _failedGates: StandardFailedGate[] = [],
    score: number = 0
  ): string {
    if (!reason) return 'Failed validation gate criteria.';
    const clean = reason
      .replace(/^REJECTED:\s*/i, '')
      .replace(/^Gate \d+\s*(Validation|Hard Gates|Cap)?:?\s*/i, '')
      .replace(/^Signal Validation:\s*/i, '')
      .trim();

    if (clean.includes('GROSS_RR_BELOW_THRESHOLD') || clean.includes('Gross R:R') || clean.includes('rrRatio') || clean.includes('R:R')) {
      const match = clean.match(/R:R\s*\(([\d.]+)\)\s*below\s*([\d.]+)/i);
      if (match) {
        return `Risk/reward only ${match[1]}:1; minimum required is ${match[2]}:1.`;
      }
      const minimumRR = serverConfig?.getConfig?.()?.thresholds?.minimumRR ?? 1.8;
      return `Risk/reward ratio below required minimum threshold (${minimumRR}:1).`;
    }

    if (clean.includes('Entry too close to major resistance') || clean.includes('resistance')) {
      return 'Entry too close to major resistance.';
    }

    if (clean.includes('SCORE_BELOW_THRESHOLD') || clean.includes('Composite signal score')) {
      const minThreshold = serverConfig?.getConfig?.()?.thresholds?.signalThreshold ?? 70;
      return `Signal score (${score}/100) is below the minimum tradeability threshold of ${minThreshold}.`;
    }

    if (clean.includes('Exceeded max allowed signals')) {
      return 'Exceeded maximum allowed signal cap for current scan session.';
    }

    if (clean.includes('Estimated win rate')) {
      const match = clean.match(/\(([\d.]+)%\s*<=\s*([\d.]+)%/);
      if (match) {
        return `Estimated win rate (${match[1]}%) below required threshold (${match[2]}%).`;
      }
      return 'Estimated win rate below required threshold.';
    }

    if (clean.includes('Non-positive expectancy')) {
      return 'Expected return ratio is non-positive.';
    }

    return clean;
  }

  /**
   * Records or updates a candidate's evaluation and rejection audit.
   */
  public recordCandidate(audit: CandidateRejectionAudit): void {
    const minThreshold = serverConfig?.getConfig?.()?.thresholds?.signalThreshold ?? 70;
    const cleanAudit = { ...audit };
    const effectiveScore = cleanAudit.finalScore ?? cleanAudit.score ?? cleanAudit.scoreBeforeGate6 ?? 0;
    const isThresholdPlusRejected = (effectiveScore >= minThreshold || (cleanAudit.scoreBeforeGate6 ?? 0) >= minThreshold || cleanAudit.isQualifiedRejected === true) && cleanAudit.finalDecision === 'REJECTED';
    const statusText = cleanAudit.finalDecision === 'REJECTED' ? 'REJECTED — NOT TRADEABLE' : (cleanAudit.statusText || 'TRADEABLE');
    const failedGates = Array.from(new Set(cleanAudit.failedGates || []));
    const rejectionSummary = cleanAudit.rejectionSummary || CandidateRejectionTracker.formatHumanReadableSummary(cleanAudit.primaryRejectionReason, failedGates, effectiveScore);
    const timestamp = cleanAudit.timestamp || Date.now();

    // Clear zero values to prevent overwriting existing valid data or logging them as 0
    if (cleanAudit.entryPrice === 0) delete cleanAudit.entryPrice;
    if (cleanAudit.stopLoss === 0) delete cleanAudit.stopLoss;
    if (cleanAudit.takeProfit === 0) delete cleanAudit.takeProfit;
    if (cleanAudit.tp1 === 0) delete cleanAudit.tp1;
    if (cleanAudit.tp2 === 0) delete cleanAudit.tp2;
    if (cleanAudit.tp3 === 0) delete cleanAudit.tp3;
    if (cleanAudit.grossRR === 0) delete cleanAudit.grossRR;
    if (cleanAudit.effectiveGrossRR === 0) delete cleanAudit.effectiveGrossRR;
    if (cleanAudit.primaryRR === 0) delete cleanAudit.primaryRR;
    if (cleanAudit.tp1RR === 0) delete cleanAudit.tp1RR;
    if (cleanAudit.tp2RR === 0) delete cleanAudit.tp2RR;
    if (cleanAudit.tp3RR === 0) delete cleanAudit.tp3RR;

    const candidateKey = `${cleanAudit.symbol}_${cleanAudit.direction}`;
    const existing = this.records.get(candidateKey);
    if (existing) {
      // Telemetry strictly reflects the CURRENT evaluation's failed gates,
      // never a union of historical failed gates.
      const everReachedThreshold = (existing.score >= minThreshold) || (existing.scoreBeforeGate6 ?? 0) >= minThreshold || (existing.everReachedThreshold === true) || isThresholdPlusRejected;
      const isStillThresholdPlusRejected = (everReachedThreshold || effectiveScore >= minThreshold) && cleanAudit.finalDecision === 'REJECTED';

      this.records.set(candidateKey, {
        ...cleanAudit,
        score: effectiveScore,
        finalScore: cleanAudit.finalScore ?? effectiveScore,
        failedGates,
        isQualifiedRejected: isStillThresholdPlusRejected,
        everReachedThreshold,
        statusText,
        rejectionSummary,
        timestamp,
      });
    } else {
      this.records.set(candidateKey, {
        ...cleanAudit,
        score: effectiveScore,
        finalScore: cleanAudit.finalScore ?? effectiveScore,
        failedGates,
        isQualifiedRejected: isThresholdPlusRejected,
        everReachedThreshold: isThresholdPlusRejected,
        statusText,
        rejectionSummary,
        timestamp,
      });
    }

    // Output structured console log for candidate rejection audit
    this.logCandidateAudit(this.records.get(candidateKey)!);
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
      `finalDecision: ${audit.finalDecision}` +
      (audit.tpDiagnostics ? `\ntpDiagnostics: ${JSON.stringify(audit.tpDiagnostics)}` : '')
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
   * Returns exact counts for the 5 mandated tracking categories:
   * - candidatesRejectedBeforeMTF
   * - candidatesRejectedByMTF
   * - candidatesRejectedByScore
   * - candidatesRejectedByRR
   * - candidatesRejectedByStructure
   */
  public getCategorizedRejectionCounts(): {
    candidatesRejectedBeforeMTF: number;
    candidatesRejectedByMTF: number;
    candidatesRejectedByScore: number;
    candidatesRejectedByRR: number;
    candidatesRejectedByStructure: number;
  } {
    let beforeMTF = 0;
    let byMTF = 0;
    let byScore = 0;
    let byRR = 0;
    let byStructure = 0;

    for (const record of this.records.values()) {
      if (record.finalDecision === 'REJECTED' || record.failedGates.length > 0) {
        const isBeforeMTF =
          record.failedGates.includes(StandardFailedGate.FINAL_SCORE_UNREACHABLE) ||
          record.stage === 'Gate 6 Pre-Audit' ||
          record.stage === 'Stage 0' ||
          record.stage === 'Stage 1';

        const isMTF = record.failedGates.includes(StandardFailedGate.MTF_ALIGNMENT);
        const isScore = record.failedGates.includes(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
        const isRR = record.failedGates.includes(StandardFailedGate.RR) || record.failedGates.includes('RR_INVALID' as StandardFailedGate);
        const isStructure = record.failedGates.includes(StandardFailedGate.MARKET_STRUCTURE);

        if (isBeforeMTF) beforeMTF++;
        if (isMTF) byMTF++;
        if (isScore) byScore++;
        if (isRR) byRR++;
        if (isStructure) byStructure++;
      }
    }

    return {
      candidatesRejectedBeforeMTF: beforeMTF,
      candidatesRejectedByMTF: byMTF,
      candidatesRejectedByScore: byScore,
      candidatesRejectedByRR: byRR,
      candidatesRejectedByStructure: byStructure,
    };
  }

  /**
   * Aggregates scan-wide rejection reason counts.
   * Returns a map of standard failed gate code -> count of candidates failing that gate.
   */
  public getAggregatedRejectionReasons(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of this.records.values()) {
      if (record.finalDecision === 'REJECTED' || record.failedGates.length > 0) {
        if (record.failedGates && record.failedGates.length > 0) {
          const uniqueGates = Array.from(new Set(record.failedGates));
          for (const gate of uniqueGates) {
            counts[gate] = (counts[gate] || 0) + 1;
          }
        } else {
          counts['OTHER_REJECTION'] = (counts['OTHER_REJECTION'] || 0) + 1;
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

    const minThreshold = serverConfig.getConfig().thresholds.signalThreshold;
    if (typeof minThreshold !== 'number' || isNaN(minThreshold)) {
      throw new Error(`[CandidateRejectionTracker] Authoritative signalThreshold is missing or invalid in serverConfig`);
    }
    // A candidate scoring >= minThreshold MUST NOT receive FINAL_SCORE_BELOW_THRESHOLD
    if (score < minThreshold && (score > 0 || rejectionReason.toLowerCase().includes('score'))) {
      gates.add(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
    }

    if (gates.size === 0) {
      const inferred = CandidateRejectionTracker.inferFailedGatesFromReason(rejectionReason, score);
      for (const g of inferred) {
        gates.add(g);
      }
    }

    return Array.from(gates);
  }

  /**
   * Infers StandardFailedGate list from a textual rejection message or reason.
   */
  public static inferFailedGatesFromReason(reason: string, score = 0): StandardFailedGate[] {
    const failedGates = new Set<StandardFailedGate>();
    const lower = (reason || '').toLowerCase();

    const minThreshold = serverConfig.getConfig().thresholds.signalThreshold;
    if (typeof minThreshold !== 'number' || isNaN(minThreshold)) {
      throw new Error(`[CandidateRejectionTracker] Authoritative signalThreshold is missing or invalid in serverConfig`);
    }
    // The authoritative rule:
    // score < minThreshold → FINAL_SCORE_BELOW_THRESHOLD
    // score >= minThreshold → score gate PASSED. MUST NOT receive FINAL_SCORE_BELOW_THRESHOLD.
    if (score < minThreshold && (score > 0 || lower.includes('score') || lower.includes('final_score') || lower.includes('hurdle') || lower.includes('tradeability threshold') || lower.includes('scoring criteria'))) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
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
    if (/\b(rr|r:r|risk[- ]reward|risk\/reward)\b/i.test(reason) || lower.includes('reward') || (lower.includes('risk') && !lower.includes('risk cap') && !lower.includes('portfolio risk') && !lower.includes('risk limit') && !lower.includes('risk_cap') && !lower.includes('max daily risk'))) {
      failedGates.add(StandardFailedGate.RR);
    }
    if (/\b(sl|tp)\b/i.test(reason) || lower.includes('stop loss') || lower.includes('take profit') || lower.includes('stop-loss') || lower.includes('take-profit') || lower.includes('distance')) {
      failedGates.add(StandardFailedGate.SL_TP_VALIDITY);
    }
    if (lower.includes('duplicate') || lower.includes('active signal') || lower.includes('existing') || lower.includes('fingerprint')) {
      failedGates.add(StandardFailedGate.DUPLICATE_OR_EXISTING_SIGNAL);
    }
    if (lower.includes('cooldown') || lower.includes('cool down')) {
      failedGates.add(StandardFailedGate.COOLDOWN);
    }
    if (lower.includes('session') || lower.includes('market closed') || lower.includes('weekend')) {
      failedGates.add(StandardFailedGate.MARKET_SESSION_STATUS);
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
      if (score < 70) {
        failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
      } else {
        failedGates.add(StandardFailedGate.DATA_INTEGRITY);
      }
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
    if (score < 70) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
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
    const targetScoreThreshold = thresholds.signalThreshold;

    if (scoring.score < targetScoreThreshold) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
    }
    if (reasonLower.includes('directional') || reasonLower.includes('trend') || 
        (scoring.factors?.higherTfTrendScore && scoring.factors.higherTfTrendScore < 14) ||
        (scoring.factors?.trendAlignment && scoring.factors.trendAlignment < 14)) {
      failedGates.add(StandardFailedGate.TREND);
    }
    if (reasonLower.includes('momentum') || 
        (scoring.factors?.momentumScore && scoring.factors.momentumScore < 10) ||
        (scoring.factors?.momentum && scoring.factors.momentum < 10)) {
      failedGates.add(StandardFailedGate.MOMENTUM);
    }
    if (reasonLower.includes('structure') || 
        (scoring.factors?.marketStructureScore && scoring.factors.marketStructureScore < 10) ||
        (scoring.factors?.marketStructure && scoring.factors.marketStructure < 10)) {
      failedGates.add(StandardFailedGate.MARKET_STRUCTURE);
    }
    if (reasonLower.includes('volume') || 
        (scoring.factors?.volumeOrderFlowScore && scoring.factors.volumeOrderFlowScore < 10) ||
        (scoring.factors?.volumeLiquidity && scoring.factors.volumeLiquidity < 10)) {
      failedGates.add(StandardFailedGate.VOLUME);
    }
    if (reasonLower.includes('volatility') || reasonLower.includes('atr') || 
        (scoring.factors?.volatilityAtrScore && scoring.factors.volatilityAtrScore < 7) ||
        (scoring.factors?.volatilityAtrQuality && scoring.factors.volatilityAtrQuality < 7)) {
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
      if (scoring.score < thresholds.signalThreshold) {
        failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
      } else {
        failedGates.add(StandardFailedGate.DATA_INTEGRITY);
      }
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
    threshold?: number
  ): { primaryReason: string; failedGates: StandardFailedGate[] } {
    const minThreshold = typeof threshold === 'number' && !isNaN(threshold)
      ? threshold
      : serverConfig.getConfig().thresholds.signalThreshold;
    const failedGates: Set<StandardFailedGate> = new Set();

    if (gate8Eval.finalScore < minThreshold) {
      failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
    }

    const factors = gate8Eval.factors || {};
    if ((factors.higherTfTrendScore !== undefined && factors.higherTfTrendScore < 14) ||
        (factors.trendAlignment !== undefined && factors.trendAlignment < 14)) {
      failedGates.add(StandardFailedGate.TREND);
    }
    if ((factors.mtfConfluenceScore !== undefined && factors.mtfConfluenceScore < 11) ||
        (factors.mtfConfirmation !== undefined && factors.mtfConfirmation < 11)) {
      failedGates.add(StandardFailedGate.MTF_ALIGNMENT);
    }
    if ((factors.momentumScore !== undefined && factors.momentumScore < 10) ||
        (factors.momentum !== undefined && factors.momentum < 10)) {
      failedGates.add(StandardFailedGate.MOMENTUM);
    }
    if ((factors.marketStructureScore !== undefined && factors.marketStructureScore < 10) ||
        (factors.marketStructure !== undefined && factors.marketStructure < 10)) {
      failedGates.add(StandardFailedGate.MARKET_STRUCTURE);
    }
    if ((factors.volumeOrderFlowScore !== undefined && factors.volumeOrderFlowScore < 10) ||
        (factors.volumeLiquidity !== undefined && factors.volumeLiquidity < 10)) {
      failedGates.add(StandardFailedGate.VOLUME);
    }
    if ((factors.volatilityAtrScore !== undefined && factors.volatilityAtrScore < 7) ||
        (factors.volatilityAtrQuality !== undefined && factors.volatilityAtrQuality < 7)) {
      failedGates.add(StandardFailedGate.VOLATILITY);
    }
    if ((factors.entryQualityScore !== undefined && factors.entryQualityScore < 7) ||
        (factors.entryQuality !== undefined && factors.entryQuality < 7)) {
      failedGates.add(StandardFailedGate.INVALID_ENTRY);
    }
    if ((factors.riskRewardScore !== undefined && factors.riskRewardScore < 3.5) ||
        (factors.rrQuality !== undefined && factors.rrQuality < 3.5)) {
      failedGates.add(StandardFailedGate.RR);
    }

    if (failedGates.size === 0) {
      if (gate8Eval.finalScore < minThreshold) {
        failedGates.add(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
      } else {
        failedGates.add(StandardFailedGate.DATA_INTEGRITY);
      }
    }

    return {
      primaryReason: gate8Eval.rejectionReason || (gate8Eval.finalScore < minThreshold
        ? `FINAL_SCORE_BELOW_THRESHOLD: Core score (${gate8Eval.finalScore}/100) below required threshold of ${minThreshold}`
        : `Gate 8 Tradeability Criteria Not Satisfied`),
      failedGates: Array.from(failedGates),
    };
  }
}
