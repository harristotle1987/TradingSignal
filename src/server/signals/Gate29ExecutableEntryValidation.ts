/**
 * GATE 29 — EXECUTABLE ENTRY VALIDATION
 *
 * OBJECTIVE:
 * Ensure signals are validated for entry against actual executable side prices (ASK for BUY, BID for SELL)
 * rather than relying on mid-prices or mid-price touches that fail to execute in real trading.
 *
 * RULES:
 * 1. BUY: Evaluate executable ASK price. Ask must touch/cross entry level (ask <= entryPrice + EPSILON).
 * 2. SELL: Evaluate executable BID price. Bid must touch/cross entry level (bid >= entryPrice - EPSILON).
 * 3. FALLBACK: If bid/ask is unavailable (e.g., historical candles or scalar price feed), fallback to standard market price model.
 * 4. RECORD:
 *    - displayPrice (last/market display price)
 *    - bid (bid price if available)
 *    - ask (ask price if available)
 *    - executionSide ('ASK' for BUY, 'BID' for SELL)
 *    - executionPrice (ask for BUY, bid for SELL, or fallback display price)
 *    - spread (ask - bid if available, else 0)
 *    - entryTriggerTimestamp (ISO 8601 UTC timestamp of trigger)
 * 5. PRESERVE: Do NOT change strategy direction logic.
 */

import { SignalDirection } from '../../types/index.js';
import { logger } from '../logger.js';

export interface ExecutableEntryQuote {
  price: number;
  bid?: number | null;
  ask?: number | null;
  timestamp?: number;
}

export interface ExecutableEntryValidationResult {
  isEntryConfirmed: boolean;
  displayPrice: number;
  bid?: number;
  ask?: number;
  executionSide: 'ASK' | 'BID';
  executionPrice: number;
  spread: number;
  entryTriggerTimestamp?: string;
  isFallbackUsed: boolean;
  reason: string;
}

export class Gate29ExecutableEntryValidation {
  private static readonly EPSILON = 1e-8;

  /**
   * Evaluates if a market quote fulfills executable entry requirements for a given signal direction and entry price.
   */
  public static validateEntry(
    direction: SignalDirection,
    entryPrice: number,
    quote: ExecutableEntryQuote,
    eventTimestampMs: number = Date.now()
  ): ExecutableEntryValidationResult {
    const displayPrice = quote.price;
    const bid = (quote.bid !== null && quote.bid !== undefined && quote.bid > 0) ? quote.bid : undefined;
    const ask = (quote.ask !== null && quote.ask !== undefined && quote.ask > 0) ? quote.ask : undefined;
    const executionSide: 'ASK' | 'BID' = direction === 'BUY' ? 'ASK' : 'BID';

    let executionPrice: number;
    let isFallbackUsed = false;
    let spread = 0;

    if (bid !== undefined && ask !== undefined) {
      spread = Math.max(0, ask - bid);
      executionPrice = direction === 'BUY' ? ask : bid;
    } else if (direction === 'BUY' && ask !== undefined) {
      executionPrice = ask;
      spread = 0;
    } else if (direction === 'SELL' && bid !== undefined) {
      executionPrice = bid;
      spread = 0;
    } else {
      // Fallback: bid/ask unavailable -> use display price
      executionPrice = displayPrice;
      isFallbackUsed = true;
      spread = 0;
    }

    let isEntryConfirmed = false;
    if (direction === 'BUY') {
      // BUY entry confirmed if executable ASK price is at or below entry price
      if (executionPrice <= entryPrice + this.EPSILON) {
        isEntryConfirmed = true;
      }
    } else {
      // SELL entry confirmed if executable BID price is at or above entry price
      if (executionPrice >= entryPrice - this.EPSILON) {
        isEntryConfirmed = true;
      }
    }

    const isoTimestamp = new Date(eventTimestampMs).toISOString();
    const entryTriggerTimestamp = isEntryConfirmed ? isoTimestamp : undefined;

    const sideText = isFallbackUsed ? `FALLBACK_MID (${displayPrice})` : `${executionSide} (${executionPrice})`;
    const reason = isEntryConfirmed
      ? `Gate 29 Entry Confirmed via ${sideText} touching/crossing entry ${entryPrice} (Spread: ${spread.toFixed(5)}).`
      : `Gate 29 Entry Rejected. Executable ${sideText} did not reach entry ${entryPrice}.`;

    logger.debug(`[Gate 29 Executable Entry] direction=${direction} entryPrice=${entryPrice} side=${executionSide} execPrice=${executionPrice} confirmed=${isEntryConfirmed}`);

    return {
      isEntryConfirmed,
      displayPrice,
      bid,
      ask,
      executionSide,
      executionPrice,
      spread,
      entryTriggerTimestamp,
      isFallbackUsed,
      reason,
    };
  }
}
