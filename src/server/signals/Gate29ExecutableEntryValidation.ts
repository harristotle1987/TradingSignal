/**
 * GATE 29 & GATE 47 — EXECUTABLE ENTRY & HISTORICAL EXECUTION EVIDENCE POLICY
 *
 * OBJECTIVE:
 * 1. Ensure live signals are validated for entry against actual executable side prices (ASK for BUY, BID for SELL).
 * 2. Historical OHLC data does NOT contain actual bid/ask; therefore, do not represent candle high/low touching
 *    an entry as equivalent to confirmed executable entry.
 *
 * EXPLICIT EXECUTION EVIDENCE STATES:
 * - CONFIRMED_EXECUTABLE: Verified by actual executable side price (ASK for BUY, BID for SELL).
 * - CONFIRMED_CANDLE_TOUCH / HISTORICAL_CANDLE_TOUCH: Candle high/low touched entry in historical OHLC data without bid/ask.
 * - UNVERIFIABLE: Missing or unverified data that cannot prove executable entry.
 * - NOT_REACHED: Price/candle did not reach the entry level.
 * - AMBIGUOUS: Intra-candle conflict or indeterminate order execution.
 *
 * FOR REAL-TIME / LIVE QUOTES:
 * - BUY -> ASK
 * - SELL -> BID
 *
 * FOR HISTORICAL CANDLES:
 * - If bid/ask history exists: use it (BUY -> ASK, SELL -> BID).
 * - If bid/ask history does NOT exist: mark result as HISTORICAL_CANDLE_TOUCH and do not claim exact executable confirmation.
 *
 * CONFIGURABLE BEHAVIOR:
 * HISTORICAL_ENTRY_POLICY =
 * - CONSERVATIVE (Recommended production setting / default): Do not automatically convert candle touch into executed trade.
 * - CANDLE_TOUCH: Permissive mode allowing historical candle touch to confirm entry.
 * - UNVERIFIABLE: Mark historical OHLC touches as UNVERIFIABLE and reject confirmation.
 */

import { SignalDirection, ExecutionEvidenceState, HistoricalEntryPolicy } from '../../types/index.js';
import { HISTORICAL_ENTRY_POLICY } from '../config.js';
import { logger } from '../logger.js';

export interface ExecutableEntryQuote {
  price: number;
  bid?: number | null;
  ask?: number | null;
  high?: number | null;
  low?: number | null;
  isHistoricalCandle?: boolean;
  source?: 'LIVE' | 'HISTORICAL' | 'CANDLE';
  timestamp?: number;
  policy?: HistoricalEntryPolicy;
}

export interface ExecutableEntryValidationResult {
  isEntryConfirmed: boolean;
  executionEvidence: ExecutionEvidenceState;
  displayPrice: number;
  bid?: number;
  ask?: number;
  executionSide: 'ASK' | 'BID';
  executionPrice: number;
  spread: number;
  entryTriggerTimestamp?: string;
  isFallbackUsed: boolean;
  policyUsed: HistoricalEntryPolicy;
  reason: string;
}

export class Gate29ExecutableEntryValidation {
  private static readonly EPSILON = 1e-8;

  /**
   * Evaluates if a market quote fulfills executable entry requirements for a given signal direction and entry price,
   * applying Gate 47 Historical Execution Evidence Policy.
   */
  public static validateEntry(
    direction: SignalDirection,
    entryPrice: number,
    quote: ExecutableEntryQuote,
    eventTimestampMs: number = Date.now(),
    policyOverride?: HistoricalEntryPolicy
  ): ExecutableEntryValidationResult {
    const displayPrice = quote.price;
    const bid = (quote.bid !== null && quote.bid !== undefined && quote.bid > 0) ? quote.bid : undefined;
    const ask = (quote.ask !== null && quote.ask !== undefined && quote.ask > 0) ? quote.ask : undefined;
    const executionSide: 'ASK' | 'BID' = direction === 'BUY' ? 'ASK' : 'BID';

    const policy: HistoricalEntryPolicy =
      policyOverride ||
      quote.policy ||
      HISTORICAL_ENTRY_POLICY ||
      'CONSERVATIVE';

    const hasBidAsk = bid !== undefined && ask !== undefined;
    const isHistorical = quote.isHistoricalCandle === true || quote.source === 'HISTORICAL' || quote.source === 'CANDLE';

    let executionPrice: number;
    let isFallbackUsed = false;
    let spread = 0;
    let executionEvidence: ExecutionEvidenceState = 'NOT_REACHED';
    let isEntryConfirmed = false;

    if (hasBidAsk) {
      // 1. Explicit Bid/Ask Available (Live quote or historical quote with full L2/orderbook history)
      spread = Math.max(0, ask - bid);
      executionPrice = direction === 'BUY' ? ask : bid;

      if (direction === 'BUY') {
        if (executionPrice <= entryPrice + this.EPSILON) {
          isEntryConfirmed = true;
          executionEvidence = 'CONFIRMED_EXECUTABLE';
        } else {
          isEntryConfirmed = false;
          executionEvidence = 'NOT_REACHED';
        }
      } else {
        // SELL
        if (executionPrice >= entryPrice - this.EPSILON) {
          isEntryConfirmed = true;
          executionEvidence = 'CONFIRMED_EXECUTABLE';
        } else {
          isEntryConfirmed = false;
          executionEvidence = 'NOT_REACHED';
        }
      }
    } else if (direction === 'BUY' && ask !== undefined) {
      // Partial quote: only ask available for BUY
      executionPrice = ask;
      spread = 0;
      if (executionPrice <= entryPrice + this.EPSILON) {
        isEntryConfirmed = true;
        executionEvidence = 'CONFIRMED_EXECUTABLE';
      } else {
        isEntryConfirmed = false;
        executionEvidence = 'NOT_REACHED';
      }
    } else if (direction === 'SELL' && bid !== undefined) {
      // Partial quote: only bid available for SELL
      executionPrice = bid;
      spread = 0;
      if (executionPrice >= entryPrice - this.EPSILON) {
        isEntryConfirmed = true;
        executionEvidence = 'CONFIRMED_EXECUTABLE';
      } else {
        isEntryConfirmed = false;
        executionEvidence = 'NOT_REACHED';
      }
    } else {
      // 2. Historical Candle or Scalar Price Feed without Bid/Ask
      isFallbackUsed = true;
      executionPrice = displayPrice;
      spread = 0;

      const evalPrice = direction === 'BUY'
        ? (quote.low !== undefined && quote.low !== null ? quote.low : displayPrice)
        : (quote.high !== undefined && quote.high !== null ? quote.high : displayPrice);

      const touchesEntry = direction === 'BUY'
        ? evalPrice <= entryPrice + this.EPSILON
        : evalPrice >= entryPrice - this.EPSILON;

      if (touchesEntry) {
        if (policy === 'UNVERIFIABLE') {
          executionEvidence = 'UNVERIFIABLE';
          isEntryConfirmed = false;
        } else if (policy === 'CANDLE_TOUCH') {
          executionEvidence = 'HISTORICAL_CANDLE_TOUCH';
          isEntryConfirmed = true;
        } else {
          // CONSERVATIVE (Default): Do not claim exact executable entry confirmation
          executionEvidence = 'HISTORICAL_CANDLE_TOUCH';
          isEntryConfirmed = false;
        }
      } else {
        executionEvidence = 'NOT_REACHED';
        isEntryConfirmed = false;
      }
    }

    const isoTimestamp = new Date(eventTimestampMs).toISOString();
    const entryTriggerTimestamp = isEntryConfirmed ? isoTimestamp : undefined;

    let reason: string;
    if (executionEvidence === 'CONFIRMED_EXECUTABLE') {
      reason = `Gate 47 / Gate 29 Entry Confirmed: Executable ${executionSide} (${executionPrice}) reached entry ${entryPrice} (Spread: ${spread.toFixed(5)}). Evidence: CONFIRMED_EXECUTABLE.`;
    } else if (executionEvidence === 'HISTORICAL_CANDLE_TOUCH') {
      if (isEntryConfirmed) {
        reason = `Gate 47 Candle Touch Entry Confirmed under CANDLE_TOUCH policy: Chart touch at ${displayPrice} reached entry ${entryPrice} without bid/ask history. Evidence: HISTORICAL_CANDLE_TOUCH.`;
      } else {
        reason = `Gate 47 Historical Execution Evidence Policy (${policy}): Candle touched entry level ${entryPrice} at price ${displayPrice}, but bid/ask history is missing. Not claimed as confirmed executable entry. Evidence: HISTORICAL_CANDLE_TOUCH.`;
      }
    } else if (executionEvidence === 'UNVERIFIABLE') {
      reason = `Gate 47 Entry Rejected: Historical quote at ${displayPrice} lacks bid/ask verification and policy is UNVERIFIABLE. Evidence: UNVERIFIABLE.`;
    } else {
      const sideText = isFallbackUsed ? `MID price (${displayPrice})` : `Executable ${executionSide} (${executionPrice})`;
      reason = `Gate 47 / Gate 29 Entry Rejected: ${sideText} did not reach entry ${entryPrice}. Evidence: NOT_REACHED.`;
    }

    logger.debug(`[Gate 47 Entry Validation] direction=${direction} entryPrice=${entryPrice} side=${executionSide} execPrice=${executionPrice} evidence=${executionEvidence} confirmed=${isEntryConfirmed} policy=${policy}`);

    return {
      isEntryConfirmed,
      executionEvidence,
      displayPrice,
      bid,
      ask,
      executionSide,
      executionPrice,
      spread,
      entryTriggerTimestamp,
      isFallbackUsed,
      policyUsed: policy,
      reason,
    };
  }
}
