/**
 * GATE 34 — EXECUTION FRICTION STRESS TEST ENGINE
 *
 * OBJECTIVE:
 * Stress test trade signals under realistic and adverse market execution friction:
 * 1. Calculate:
 *    - Gross R:R (Raw Reward / Raw Risk)
 *    - Normal Net R:R (Adjusted for baseline spread, normal slippage, fees & latency buffer)
 *    - Adverse Net R:R (Adjusted for stressed market conditions: wider spread, spike slippage, fees & latency lag)
 * 2. Friction Components:
 *    - Spread (Bid/Ask gap)
 *    - Estimated Slippage (Never assume zero slippage!)
 *    - Fees (Broker commissions, maker/taker exchange fees, SEC/FINRA clearing fees)
 *    - Latency Buffer (Execution delay impact during micro-volatility)
 * 3. Asset-Specific Friction Profiles:
 *    - FOREX (pip/point based, accounting for JPY vs non-JPY pairs)
 *    - CRYPTO (percentage based, accounting for taker fees and order book depth)
 *    - STOCKS / INDEX (cents/share + percentage clearing fees)
 * 4. Decision Rule:
 *    - Reject ONLY when configured safety thresholds fail.
 *    - Expose all calculations for full auditability.
 */

import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';

export interface FrictionBreakdown {
  spread: number;
  slippage: number;        // NEVER zero!
  fees: number;
  latencyBuffer: number;
  totalFrictionPrice: number;
  netReward: number;
  netRisk: number;
  netRR: number;
  frictionRatio: number;   // totalFrictionPrice / rawReward
}

export interface FrictionStressTestResult {
  symbol: string;
  assetClass: 'FOREX' | 'CRYPTO' | 'STOCKS' | 'INDEX';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rawRisk: number;
  rawReward: number;
  grossRR: number;
  normal: FrictionBreakdown;
  adverse: FrictionBreakdown;
  isPassed: boolean;
  rejectionReason?: string;
  reasons: string[];
  explanation: string;
}

export interface FrictionTestThresholds {
  minimumNetRR?: number;          // Default from config or 1.50
  minimumAdverseNetRR?: number;   // Default 1.00 (must be net breakeven or better under adverse stress)
  maxFrictionRatio?: number;      // Default 0.25 (25% max friction of raw reward)
  minSafetyBufferMultiplier?: number; // Default 3.5 (rawReward >= friction * 3.5)
}

export class Gate34ExecutionFrictionStressTest {
  /**
   * Main Gate 34 Entry Point: Evaluates execution friction stress test for a signal.
   */
  public static evaluate(
    symbol: string,
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    thresholdOverrides?: FrictionTestThresholds
  ): FrictionStressTestResult {
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
    const assetClassUpper = SymbolNormalizer.getAssetClassification(cleanSymbol).toUpperCase();

    const assetClass: 'FOREX' | 'CRYPTO' | 'STOCKS' | 'INDEX' =
      assetClassUpper === 'FOREX' ? 'FOREX' :
      assetClassUpper === 'CRYPTO' ? 'CRYPTO' :
      assetClassUpper === 'INDEX' ? 'INDEX' : 'STOCKS';

    const rawRisk = Math.abs(entryPrice - stopLoss);
    const rawReward = Math.abs(takeProfit - entryPrice);
    const grossRR = rawRisk > 0 ? parseFloat((rawReward / rawRisk).toFixed(2)) : 0;

    // Build normal and adverse friction breakdowns based on asset-specific profile
    const normalFriction = this.calculateNormalFriction(cleanSymbol, assetClass, entryPrice, rawReward, rawRisk);
    const adverseFriction = this.calculateAdverseFriction(cleanSymbol, assetClass, entryPrice, rawReward, rawRisk);

    // Resolve safety thresholds
    const cfg = serverConfig.getConfig().thresholds;
    const minNetRR = thresholdOverrides?.minimumNetRR ?? cfg.minimumNetRR ?? 1.50;
    const minAdverseNetRR = thresholdOverrides?.minimumAdverseNetRR ?? 1.00;
    const maxFrictionRatio = thresholdOverrides?.maxFrictionRatio ?? 0.25;
    const minSafetyBufferMult = thresholdOverrides?.minSafetyBufferMultiplier ?? 3.5;

    const reasons: string[] = [];
    let isPassed = true;
    let rejectionReason: string | undefined = undefined;

    // 1. Safety Buffer Check (Reward must be at least minSafetyBufferMult x normal friction)
    if (rawReward < normalFriction.totalFrictionPrice * minSafetyBufferMult) {
      isPassed = false;
      rejectionReason = 'INSUFFICIENT_SAFETY_BUFFER';
      reasons.push(
        `REJECTED: INSUFFICIENT_SAFETY_BUFFER. Raw reward move (${rawReward.toFixed(5)}) is < ${minSafetyBufferMult}x normal friction (${normalFriction.totalFrictionPrice.toFixed(5)}).`
      );
    }

    // 2. Friction Ratio Check (Friction must not consume > maxFrictionRatio of raw reward)
    if (isPassed && normalFriction.frictionRatio > maxFrictionRatio) {
      isPassed = false;
      rejectionReason = 'EXECUTION_COST_TOO_HIGH';
      reasons.push(
        `REJECTED: EXECUTION_COST_TOO_HIGH. Normal friction consumes ${(normalFriction.frictionRatio * 100).toFixed(1)}% of gross reward (max allowed: ${(maxFrictionRatio * 100).toFixed(1)}%).`
      );
    }

    // 3. Normal Net R:R Threshold Check
    if (isPassed && normalFriction.netRR < minNetRR) {
      isPassed = false;
      rejectionReason = 'NET_RR_BELOW_THRESHOLD';
      reasons.push(
        `REJECTED: NET_RR_BELOW_THRESHOLD. Normal Net R:R (${normalFriction.netRR}:1) is below minimum threshold of ${minNetRR}:1 (Gross R:R: ${grossRR}:1).`
      );
    }

    // 4. Adverse Net R:R Stress Test Threshold Check
    if (isPassed && adverseFriction.netRR < minAdverseNetRR) {
      isPassed = false;
      rejectionReason = 'ADVERSE_NET_RR_BELOW_THRESHOLD';
      reasons.push(
        `REJECTED: ADVERSE_NET_RR_BELOW_THRESHOLD. Under adverse market stress (slippage/wide spread), Net R:R drops to ${adverseFriction.netRR}:1, falling below required ${minAdverseNetRR}:1 breakeven safety floor.`
      );
    }

    if (isPassed) {
      reasons.push(
        `PASSED: Execution friction stress test passed. Gross R:R=${grossRR}:1, Normal Net R:R=${normalFriction.netRR}:1, Adverse Net R:R=${adverseFriction.netRR}:1.`
      );
    }

    const explanation = `Gate 34 Stress Test for ${cleanSymbol} (${assetClass}): Passed=${isPassed}. Gross R:R=${grossRR}:1 | Normal Net R:R=${normalFriction.netRR}:1 (Friction=${normalFriction.totalFrictionPrice.toFixed(5)}) | Adverse Net R:R=${adverseFriction.netRR}:1 (Friction=${adverseFriction.totalFrictionPrice.toFixed(5)}).`;

    logger.debug(`[Gate 34 Execution Friction] ${explanation}`);

    return {
      symbol: cleanSymbol,
      assetClass,
      entryPrice,
      stopLoss,
      takeProfit,
      rawRisk,
      rawReward,
      grossRR,
      normal: normalFriction,
      adverse: adverseFriction,
      isPassed,
      rejectionReason,
      reasons,
      explanation,
    };
  }

  /**
   * Calculates baseline (normal) execution friction profile for the asset.
   */
  private static calculateNormalFriction(
    symbol: string,
    assetClass: 'FOREX' | 'CRYPTO' | 'STOCKS' | 'INDEX',
    entryPrice: number,
    rawReward: number,
    rawRisk: number
  ): FrictionBreakdown {
    let spread = 0;
    let slippage = 0;        // NEVER zero!
    let fees = 0;
    let latencyBuffer = 0;

    if (assetClass === 'FOREX') {
      const isJPY = symbol.includes('JPY');
      const pipMult = isJPY ? 100 : 10000;
      spread = (isJPY ? 2.0 : 1.2) / pipMult;
      slippage = (isJPY ? 0.8 : 0.5) / pipMult;        // Mandatory non-zero slippage
      fees = (isJPY ? 0.5 : 0.3) / pipMult;            // Broker commission
      latencyBuffer = (isJPY ? 0.5 : 0.3) / pipMult;   // Execution lag
    } else if (assetClass === 'CRYPTO') {
      spread = entryPrice * 0.0004;         // 0.04%
      slippage = entryPrice * 0.0005;       // 0.05% mandatory slippage
      fees = entryPrice * 0.0012;           // 0.12% (2x 0.06% taker fee)
      latencyBuffer = entryPrice * 0.0004;  // 0.04%
    } else {
      // STOCKS / INDEX
      spread = Math.max(0.03, entryPrice * 0.0003);
      slippage = Math.max(0.02, entryPrice * 0.0002);  // Mandatory non-zero slippage
      fees = Math.max(0.01, entryPrice * 0.0001);      // SEC/FINRA clearing
      latencyBuffer = Math.max(0.02, entryPrice * 0.0002);
    }

    const totalFrictionPrice = spread + slippage + fees + latencyBuffer;
    const netReward = Math.max(0, rawReward - totalFrictionPrice);
    const netRisk = rawRisk + totalFrictionPrice;
    const netRR = netRisk > 0 ? parseFloat((netReward / netRisk).toFixed(2)) : 0;
    const frictionRatio = rawReward > 0 ? totalFrictionPrice / rawReward : 1.0;

    return {
      spread: parseFloat(spread.toFixed(5)),
      slippage: parseFloat(slippage.toFixed(5)),
      fees: parseFloat(fees.toFixed(5)),
      latencyBuffer: parseFloat(latencyBuffer.toFixed(5)),
      totalFrictionPrice: parseFloat(totalFrictionPrice.toFixed(5)),
      netReward: parseFloat(netReward.toFixed(5)),
      netRisk: parseFloat(netRisk.toFixed(5)),
      netRR,
      frictionRatio: parseFloat(frictionRatio.toFixed(4)),
    };
  }

  /**
   * Calculates stressed (adverse) execution friction profile for the asset.
   */
  private static calculateAdverseFriction(
    symbol: string,
    assetClass: 'FOREX' | 'CRYPTO' | 'STOCKS' | 'INDEX',
    entryPrice: number,
    rawReward: number,
    rawRisk: number
  ): FrictionBreakdown {
    let spread = 0;
    let slippage = 0;
    let fees = 0;
    let latencyBuffer = 0;

    if (assetClass === 'FOREX') {
      const isJPY = symbol.includes('JPY');
      const pipMult = isJPY ? 100 : 10000;
      spread = (isJPY ? 4.5 : 2.5) / pipMult;          // Stressed wide spread
      slippage = (isJPY ? 2.5 : 1.5) / pipMult;        // Stressed spike slippage
      fees = (isJPY ? 0.5 : 0.3) / pipMult;            // Broker commission
      latencyBuffer = (isJPY ? 1.5 : 1.0) / pipMult;   // Severe execution delay
    } else if (assetClass === 'CRYPTO') {
      spread = entryPrice * 0.0012;         // 0.12% stressed spread
      slippage = entryPrice * 0.0025;       // 0.25% order book slippage
      fees = entryPrice * 0.0012;           // 0.12% taker fee
      latencyBuffer = entryPrice * 0.0015;  // 0.15% network/latency lag
    } else {
      // STOCKS / INDEX
      spread = Math.max(0.10, entryPrice * 0.0010);
      slippage = Math.max(0.08, entryPrice * 0.0008);
      fees = Math.max(0.01, entryPrice * 0.0001);
      latencyBuffer = Math.max(0.06, entryPrice * 0.0006);
    }

    const totalFrictionPrice = spread + slippage + fees + latencyBuffer;
    const netReward = Math.max(0, rawReward - totalFrictionPrice);
    const netRisk = rawRisk + totalFrictionPrice;
    const netRR = netRisk > 0 ? parseFloat((netReward / netRisk).toFixed(2)) : 0;
    const frictionRatio = rawReward > 0 ? totalFrictionPrice / rawReward : 1.0;

    return {
      spread: parseFloat(spread.toFixed(5)),
      slippage: parseFloat(slippage.toFixed(5)),
      fees: parseFloat(fees.toFixed(5)),
      latencyBuffer: parseFloat(latencyBuffer.toFixed(5)),
      totalFrictionPrice: parseFloat(totalFrictionPrice.toFixed(5)),
      netReward: parseFloat(netReward.toFixed(5)),
      netRisk: parseFloat(netRisk.toFixed(5)),
      netRR,
      frictionRatio: parseFloat(frictionRatio.toFixed(4)),
    };
  }
}
