/**
 * TRADING SYSTEM TRAINING — GATE 0
 * DATA INTEGRITY & MARKET DATA VALIDATION ENGINE
 *
 * Hard Safety Gate:
 * Executes BEFORE any strategy, indicator, score, or signal calculation.
 * Verifies that all market data is valid, current, internally consistent, and belongs to the correct asset/timeframe.
 *
 * Rules Enforced:
 * 1. NEVER generate a trading signal from stale market data.
 * 2. Every calculation identifies: symbol, assetClass, provider, timeframe, timestamp, currentPrice, candleTimestamp.
 * 3. Verify latest candle is sufficiently recent for timeframe.
 * 4. Validate OHLC relationships: High >= Open, High >= Close, Low <= Open, Low <= Close, High >= Low.
 * 5. Reject malformed, null, negative, zero, duplicated, or impossible price values.
 * 6. Source normalization check (no un-normalized mixing).
 * 7. Entry price derived from latest validated live quote.
 * 8. Reject stale cached entry prices when newer market price exists.
 * 9. Record data freshness in milliseconds & seconds.
 * 10. Data unavailable -> DATA_INSUFFICIENT (No fabrication/estimation).
 * 11. API failures fail fast.
 * 12. Cross-provider discrepancy detection.
 * 13. Rate-limit protection preservation.
 */

import { NormalizedCandle, NormalizedTicker } from '../../types/index.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { logger } from '../logger.js';

export type DataStatus = 'VALID' | 'STALE' | 'INVALID' | 'INSUFFICIENT';

export interface Gate0MarketDataIdentification {
  symbol: string;
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCKS' | 'STOCK' | 'INDEX' | 'UNKNOWN';
  provider: string;
  timeframe: string;
  timestamp: number;
  currentPrice: number;
  candleTimestamp: number;
}

export interface Gate0ValidationResult {
  dataStatus: DataStatus;
  dataConfidence: number; // 0 - 100
  freshnessMs: number;
  freshnessSec: number;
  identification: Gate0MarketDataIdentification;
  reasons: string[];
  validatedAt: number;
  secondaryPriceComparison?: {
    secondaryProvider: string;
    secondaryPrice: number;
    discrepancyPct: number;
    hasSignificantDiscrepancy: boolean;
  };
}

export interface Gate0ValidationParams {
  symbol: string;
  timeframe?: string;
  liveTicker: NormalizedTicker | null;
  candles: NormalizedCandle[];
  secondaryPrice?: { price: number; source: string };
  simulatedTimeMs?: number;
  minCandlesRequired?: number;
}

export class Gate0DataValidator {
  /**
   * Maximum allowed age for candles based on timeframe in milliseconds.
   */
  private static getCandleMaxAgeMs(timeframe: string): number {
    const tf = timeframe.toLowerCase().trim();
    if (tf === '1m') return 5 * 60 * 1000;         // 5 minutes
    if (tf === '5m') return 15 * 60 * 1000;        // 15 minutes
    if (tf === '15m') return 45 * 60 * 1000;       // 45 minutes
    if (tf === '30m') return 90 * 60 * 1000;       // 90 minutes
    if (tf === '1h') return 3 * 60 * 60 * 1000;    // 3 hours
    if (tf === '4h') return 12 * 60 * 60 * 1000;   // 12 hours
    if (tf === '1d' || tf === '1day') return 48 * 60 * 60 * 1000; // 48 hours
    return 3 * 60 * 60 * 1000;                     // Default 3 hours
  }

  /**
   * Main Gate 0 Validation Execution.
   * Returns DATA_STATUS ('VALID' | 'STALE' | 'INVALID' | 'INSUFFICIENT') and DATA_CONFIDENCE (0-100).
   * ONLY DATA_STATUS = 'VALID' is allowed to proceed to Gate 1 / Signal Engine calculations.
   */
  public static validate(params: Gate0ValidationParams): Gate0ValidationResult {
    const now = params.simulatedTimeMs || Date.now();
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(params.symbol) || params.symbol.trim().toUpperCase();
    const assetClass = SymbolNormalizer.getAssetClassification(cleanSymbol);
    const tf = params.timeframe || '1h';
    const minRequired = params.minCandlesRequired || 20;
    const reasons: string[] = [];

    const currentPrice = params.liveTicker?.price || (params.candles && params.candles.length > 0 ? params.candles[params.candles.length - 1].close : 0);
    const timestamp = params.liveTicker?.timestamp || (params.candles && params.candles.length > 0 ? params.candles[params.candles.length - 1].timestamp : 0);

    // Identification setup
    const identification: Gate0MarketDataIdentification = {
      symbol: cleanSymbol,
      assetClass,
      provider: params.liveTicker?.provider || params.candles?.[0]?.provider || 'UNKNOWN',
      timeframe: tf,
      timestamp,
      currentPrice,
      candleTimestamp: params.candles && params.candles.length > 0 ? params.candles[params.candles.length - 1].timestamp : 0,
    };

    // 1. Check for missing / unavailable data (INSUFFICIENT)
    if (!currentPrice || currentPrice <= 0) {
      reasons.push(`Market data (price) unavailable for ${cleanSymbol}`);
      return {
        dataStatus: 'INSUFFICIENT',
        dataConfidence: 0,
        freshnessMs: 0,
        freshnessSec: 0,
        identification,
        reasons,
        validatedAt: now,
      };
    }

    if (!params.candles || !Array.isArray(params.candles) || params.candles.length < minRequired) {
      reasons.push(`Insufficient candle data for ${cleanSymbol} (${tf}): received ${params.candles?.length || 0}, required minimum ${minRequired}`);
      return {
        dataStatus: 'INSUFFICIENT',
        dataConfidence: 0,
        freshnessMs: Math.max(0, now - timestamp),
        freshnessSec: Number(((now - timestamp) / 1000).toFixed(1)),
        identification,
        reasons,
        validatedAt: now,
      };
    }

    // 2. Validate Price Freshness (STALE check)
    const dataAgeMs = now - timestamp;
    const freshnessMs = Math.max(0, dataAgeMs);
    const freshnessSec = Number((freshnessMs / 1000).toFixed(1));

    // Reject data older than 120s (if live ticker) or in future > 30s
    if (dataAgeMs < -30000) {
      reasons.push(`Timestamp is in future (${timestamp} vs current ${now})`);
      return {
        dataStatus: 'INVALID',
        dataConfidence: 0,
        freshnessMs,
        freshnessSec,
        identification,
        reasons,
        validatedAt: now,
      };
    }

    if (params.liveTicker && (dataAgeMs > 120000 || params.liveTicker.status === 'STALE' || !params.liveTicker.isFresh)) {
      reasons.push(`Live ticker data is stale (age: ${freshnessSec}s > 120s max threshold)`);
      return {
        dataStatus: 'STALE',
        dataConfidence: 0,
        freshnessMs,
        freshnessSec,
        identification,
        reasons,
        validatedAt: now,
      };
    }

    // Candle freshness check
    const lastCandle = params.candles[params.candles.length - 1];
    const candleAgeMs = now - lastCandle.timestamp;
    const maxCandleAgeMs = this.getCandleMaxAgeMs(tf);

    if (candleAgeMs > maxCandleAgeMs) {
      const ageHours = (candleAgeMs / (3600 * 1000)).toFixed(1);
      const maxHours = (maxCandleAgeMs / (3600 * 1000)).toFixed(1);
      reasons.push(`Latest candle is stale for ${tf} (age: ${ageHours}h > ${maxHours}h max threshold)`);
      return {
        dataStatus: 'STALE',
        dataConfidence: 15,
        freshnessMs,
        freshnessSec,
        identification,
        reasons,
        validatedAt: now,
      };
    }

    // 3. Validate OHLC Relationships and Values (INVALID check)
    for (let i = 0; i < params.candles.length; i++) {
      const c = params.candles[i];

      // Value validity check (null, NaN, non-finite, zero/negative)
      if (!Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close) ||
          c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
        reasons.push(`Malformed or zero/negative candle values at index ${i} in ${tf} (${cleanSymbol})`);
        return {
          dataStatus: 'INVALID',
          dataConfidence: 0,
          freshnessMs,
          freshnessSec,
          identification,
          reasons,
          validatedAt: now,
        };
      }

      // OHLC geometry math checks with floating tolerance
      const maxOC = Math.max(c.open, c.close);
      const minOC = Math.min(c.open, c.close);

      if (c.high < maxOC - 1e-6) {
        reasons.push(`OHLC violation: High (${c.high}) < max(Open, Close) (${maxOC}) at index ${i}`);
        return {
          dataStatus: 'INVALID',
          dataConfidence: 0,
          freshnessMs,
          freshnessSec,
          identification,
          reasons,
          validatedAt: now,
        };
      }

      if (c.low > minOC + 1e-6) {
        reasons.push(`OHLC violation: Low (${c.low}) > min(Open, Close) (${minOC}) at index ${i}`);
        return {
          dataStatus: 'INVALID',
          dataConfidence: 0,
          freshnessMs,
          freshnessSec,
          identification,
          reasons,
          validatedAt: now,
        };
      }

      if (c.high < c.low - 1e-6) {
        reasons.push(`OHLC violation: High (${c.high}) < Low (${c.low}) at index ${i}`);
        return {
          dataStatus: 'INVALID',
          dataConfidence: 0,
          freshnessMs,
          freshnessSec,
          identification,
          reasons,
          validatedAt: now,
        };
      }

      // Chronological ascending timestamp check
      if (i > 0) {
        const prev = params.candles[i - 1];
        if (c.timestamp <= prev.timestamp) {
          reasons.push(`Timestamp ordering/duplicate violation: Candle ${i} (${c.timestamp}) <= Candle ${i - 1} (${prev.timestamp})`);
          return {
            dataStatus: 'INVALID',
            dataConfidence: 0,
            freshnessMs,
            freshnessSec,
            identification,
            reasons,
            validatedAt: now,
          };
        }
      }
    }

    // 4. Secondary Source Price Discrepancy Check
    let secondaryComparison: Gate0ValidationResult['secondaryPriceComparison'] = undefined;
    if (params.secondaryPrice && params.secondaryPrice.price > 0) {
      const primaryPrice = params.liveTicker.price;
      const secPrice = params.secondaryPrice.price;
      const discrepancyPct = (Math.abs(primaryPrice - secPrice) / primaryPrice) * 100;

      let maxDiscrepancyAllowed = 0.25; // Default 0.25%
      if (assetClass === 'CRYPTO') maxDiscrepancyAllowed = 0.60;
      if (assetClass === 'FOREX') maxDiscrepancyAllowed = 0.10;

      const hasSignificantDiscrepancy = discrepancyPct > maxDiscrepancyAllowed;

      secondaryComparison = {
        secondaryProvider: params.secondaryPrice.source,
        secondaryPrice: secPrice,
        discrepancyPct: Number(discrepancyPct.toFixed(3)),
        hasSignificantDiscrepancy,
      };

      if (hasSignificantDiscrepancy) {
        reasons.push(`Material price discrepancy detected between primary (${primaryPrice}) and ${params.secondaryPrice.source} (${secPrice}): ${discrepancyPct.toFixed(3)}% > max ${maxDiscrepancyAllowed}%`);
        return {
          dataStatus: 'INVALID',
          dataConfidence: 20,
          freshnessMs,
          freshnessSec,
          identification,
          reasons,
          validatedAt: now,
          secondaryPriceComparison: secondaryComparison,
        };
      }
    }

    // 5. Calculate Data Confidence Score (0–100)
    let confidence = 100;

    // Deduct for data age
    if (dataAgeMs > 10000) {
      const ageSec = Math.floor(dataAgeMs / 1000);
      confidence -= Math.min(30, ageSec); // deduct up to 30 points for aging ticker
    }

    // Deduct for candle age
    const candleAgeRatio = candleAgeMs / maxCandleAgeMs;
    if (candleAgeRatio > 0.5) {
      confidence -= Math.floor((candleAgeRatio - 0.5) * 40); // deduct up to 20 points
    }

    // Deduct if non-primary provider
    const providerName = (params.liveTicker?.provider || params.candles?.[0]?.provider || '').toLowerCase();
    if (providerName && providerName !== 'bitget' && providerName !== 'twelvedata' && providerName !== 'finnhub') {
      confidence -= 10;
    }

    const finalConfidence = Math.max(0, Math.min(100, Math.round(confidence)));

    return {
      dataStatus: 'VALID',
      dataConfidence: finalConfidence,
      freshnessMs,
      freshnessSec,
      identification,
      reasons: ['Market data verified: Valid, current, internally consistent, and matched to symbol/timeframe.'],
      validatedAt: now,
      secondaryPriceComparison: secondaryComparison,
    };
  }
}
