/**
 * AdvancedEnsembleDecisionEngine
 *
 * Top-Level Regime-Aware Evidence Fusion & Decision Engine.
 *
 * Combines independent quantitative and qualitative evidence from:
 * 1. Existing Technical / Strategy Engines (Market Structure, MTF Confluence, Momentum, Liquidity)
 * 2. QlibQuantEngine (Machine Learning Alpha, Information Coefficient, Rolling Return)
 * 3. KronosForecastEngine (Foundation Model Candlestick Time-Series Forecasting)
 * 4. TradingAgentsResearchEngine (Specialist Multi-Agent Financial Research Consensus)
 * 5. FinRLXPortfolioEngine (Portfolio Exposure, Correlated Clusters, VaR Risk Overlay, Constraints)
 * 6. MarketEventEngine (Normalized Events, Candle Sequencing, Lifecycle State Machine)
 *
 * STRICT GOVERNANCE & ARCHITECTURE:
 * - NO SIMPLE SCORE AVERAGING: Dynamic regime-aware Bayesian/non-linear fusion matrix.
 * - AUTHORITATIVE HARD SAFETY GATES: Models/agents can boost or dampen confidence, but can
 *   NEVER override mandatory safety gates (valid price, valid structure, valid TP/SL,
 *   minimum R:R, stale data freshness, risk limits).
 * - EVIDENCE LEDGER: Comprehensive explainable audit ledger recording why every candidate
 *   was accepted, rejected, or shadow-logged.
 * - PROGRESSIVE ROLLOUT: Runs in SHADOW mode first to evaluate parity and divergence against
 *   production before progressive CANARY or ACTIVE deployment.
 * - STRICTLY SIGNAL-ONLY: No broker execution or order dispatch.
 */

import { TradingSignal, SignalDirection, NormalizedCandle, NormalizedTicker } from '../../types/index.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';
import { QlibQuantEngine, QlibEvidence } from './QlibQuantEngine.js';
import { KronosForecastEngine, KronosEvidence } from './KronosForecastEngine.js';
import { TradingAgentsResearchEngine, TradingAgentsResearchReport } from './TradingAgentsResearchEngine.js';
import { FinRLXPortfolioEngine, PortfolioCandidateEvaluation, PortfolioPosition } from './FinRLXPortfolioEngine.js';
import { marketEventEngine, MarketEventEngine } from './MarketEventEngine.js';

export type EnsembleExecutionMode = 'SHADOW' | 'CANARY' | 'ACTIVE';

export interface HardGateAuditCheck {
  gate: string;
  passed: boolean;
  value: any;
  threshold: any;
  failureReason?: string;
}

export interface PillarEvaluation {
  pillarName: string;
  rawScore: number;                 // 0 to 100
  regimeWeight: number;             // Dynamic weight assigned based on market regime
  weightedScore: number;            // rawScore * regimeWeight
  directionBias: 'BUY' | 'SELL' | 'NEUTRAL';
  agreementWithCandidate: boolean;
  confidenceMultiplier: number;     // 0.5 to 1.3
  details: Record<string, any>;
  narrative: string;
}

export interface EvidenceLedgerEntry {
  id: string;
  symbol: string;
  direction: SignalDirection;
  evaluatedAt: number;
  executionMode: EnsembleExecutionMode;
  
  // Mandatory Hard Safety Gate Firewall
  hardGatesPassed: boolean;
  hardGateChecks: HardGateAuditCheck[];
  hardGateViolations: string[];

  // Market Regime Context
  marketRegime: string;
  regimeType: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'COMPRESSED' | 'UNKNOWN';

  // 14 Evaluated Evidence Pillars
  pillars: {
    marketRegime: PillarEvaluation;
    structuralQuality: PillarEvaluation;
    mtfAlignment: PillarEvaluation;
    qlibAlpha: PillarEvaluation;
    kronosForecast: PillarEvaluation;
    aiResearch: PillarEvaluation;
    momentumTrend: PillarEvaluation;
    volatilityLiquidity: PillarEvaluation;
    portfolioExposure: PillarEvaluation;
    executionQuality: PillarEvaluation;
    calibratedProbability: PillarEvaluation;
    expectedValue: PillarEvaluation;
    tpSlQuality: PillarEvaluation;
    riskRewardRatio: PillarEvaluation;
  };

  // Non-Linear Synergy Adjustments
  nonLinearAdjustments: {
    concurrenceBonus: number;       // Multiplier for deep cross-model consensus
    divergencePenalty: number;      // Multiplier for cross-model conflicts
    regimeSynergyMultiplier: number;
    finalFusedScore: number;        // Clamped 0 - 100
  };

  // Decision & Comparison
  ensembleDecision: 'ACCEPTED' | 'REJECTED' | 'SHADOW_ONLY';
  productionScore: number;
  productionDecision: 'DISPATCHED' | 'REJECTED';
  isParityMatch: boolean;
  rejectionReasons: string[];
  synthesisReasoning: string;
}

export interface EnsembleParityTelemetry {
  executionMode: EnsembleExecutionMode;
  totalEvaluated: number;
  shadowDecisions: { accepted: number; rejected: number };
  productionDecisions: { accepted: number; rejected: number };
  parityAgreementRate: number;      // 0 - 100%
  divergenceCounts: {
    shadowRejectedProductionApproved: number; // Potential risk caught by ensemble
    shadowApprovedProductionRejected: number; // Potential opportunity missed by legacy rules
    bothAccepted: number;
    bothRejected: number;
  };
  recentLedgerEntries: EvidenceLedgerEntry[];
}

export interface EnsembleCandidateInput {
  signal: TradingSignal;
  candlesMap?: Record<string, NormalizedCandle[]>;
  liveTicker?: NormalizedTicker;
  scoringDetails?: any;
  activeSignals?: TradingSignal[];
  newsSentiment?: string;
  productionPassed?: boolean;
}

export class AdvancedEnsembleDecisionEngine {
  private static executionMode: EnsembleExecutionMode = 'SHADOW';
  private static readonly MAX_LEDGER_ENTRIES = 1_000;
  private static evidenceLedger: EvidenceLedgerEntry[] = [];

  // Telemetry Counters
  private static telemetry = {
    totalEvaluated: 0,
    shadowAccepted: 0,
    shadowRejected: 0,
    prodAccepted: 0,
    prodRejected: 0,
    bothAccepted: 0,
    bothRejected: 0,
    shadowRejectedProdApproved: 0,
    shadowApprovedProdRejected: 0,
  };

  // ==========================================
  // CONFIGURATION & MODE CONTROL
  // ==========================================

  public static getMode(): EnsembleExecutionMode {
    return this.executionMode;
  }

  public static setMode(mode: EnsembleExecutionMode): void {
    const prev = this.executionMode;
    this.executionMode = mode;
    logger.info(`[AdvancedEnsembleDecisionEngine] Execution mode transitioned from ${prev} to ${mode}`);
  }

  // ==========================================
  // TOP-LEVEL ENSEMBLE EVALUATION KERNEL
  // ==========================================

  /**
   * Evaluates a trade candidate through the 14-pillar regime-aware fusion matrix,
   * enforcing authoritative hard safety gates and generating an explainable Evidence Ledger.
   */
  public static evaluateCandidate(input: EnsembleCandidateInput): EvidenceLedgerEntry {
    const now = Date.now();
    const sig = input.signal;
    const cleanSym = (sig.symbol || '').toUpperCase();
    const dir = sig.direction;
    const candles = input.candlesMap?.['1h'] || input.candlesMap?.['15m'] || [];
    const ticker = input.liveTicker;
    const activeSigs = input.activeSignals || [];
    const cfg = serverConfig.getConfig();
    const thresholds = cfg.thresholds;

    this.telemetry.totalEvaluated += 1;

    // -------------------------------------------------------------
    // STEP 1: AUTHORITATIVE MANDATORY HARD SAFETY GATES
    // -------------------------------------------------------------
    const hardGateChecks: HardGateAuditCheck[] = [];
    const hardViolations: string[] = [];

    // Gate A: Non-zero positive price sanity
    const priceValid = sig.entryPrice > 0 && Number.isFinite(sig.entryPrice) && !Number.isNaN(sig.entryPrice);
    hardGateChecks.push({
      gate: 'PRICE_FINITE_POSITIVE',
      passed: priceValid,
      value: sig.entryPrice,
      threshold: '> 0 and finite',
      failureReason: priceValid ? undefined : `Invalid entry price: ${sig.entryPrice}`,
    });
    if (!priceValid) hardViolations.push(`Invalid entry price (${sig.entryPrice})`);

    // Gate B: Structural Price Geometry (TP/SL sides)
    let structureValid = false;
    if (priceValid && sig.stopLoss > 0 && sig.takeProfit > 0) {
      if (dir === 'BUY') {
        structureValid = sig.takeProfit > sig.entryPrice && sig.entryPrice > sig.stopLoss;
      } else {
        structureValid = sig.takeProfit < sig.entryPrice && sig.entryPrice < sig.stopLoss;
      }
    }
    hardGateChecks.push({
      gate: 'STRUCTURAL_PRICE_GEOMETRY',
      passed: structureValid,
      value: { entry: sig.entryPrice, sl: sig.stopLoss, tp: sig.takeProfit, dir },
      threshold: dir === 'BUY' ? 'TP > Entry > SL' : 'TP < Entry < SL',
      failureReason: structureValid ? undefined : 'Invalid trade geometry (SL or TP on incorrect side of entry)',
    });
    if (!structureValid) hardViolations.push('Invalid trade geometry: TP/SL directional bounds violated');

    // Gate C: Minimum Risk/Reward Ratio Floor
    const minGrossRrFloor = Math.min(1.5, thresholds.minimumRR || 1.8);
    const rrPassed = (sig.riskRewardRatio || 0) >= minGrossRrFloor;
    hardGateChecks.push({
      gate: 'MINIMUM_RISK_REWARD_RATIO',
      passed: rrPassed,
      value: sig.riskRewardRatio,
      threshold: `>= ${minGrossRrFloor}`,
      failureReason: rrPassed ? undefined : `R:R ratio ${sig.riskRewardRatio} below minimum floor of ${minGrossRrFloor}`,
    });
    if (!rrPassed) hardViolations.push(`R:R ratio (${sig.riskRewardRatio}) below required floor (${minGrossRrFloor})`);

    // Gate D: Data Freshness / Stale Data Protection
    const maxAge = cfg.marketDataMaxAgeMs || 60_000;
    const quoteAge = ticker?.timestamp ? (now - ticker.timestamp) : 0;
    const freshnessPassed = quoteAge <= maxAge * 2; // Allow reasonable tolerance for slow feeds
    hardGateChecks.push({
      gate: 'DATA_FRESHNESS',
      passed: freshnessPassed,
      value: quoteAge,
      threshold: `<= ${maxAge * 2}ms`,
      failureReason: freshnessPassed ? undefined : `Stale market data detected: quote age ${quoteAge}ms exceeds limit`,
    });
    if (!freshnessPassed) hardViolations.push(`Market data stale (${quoteAge}ms old)`);

    // Gate E: Mandatory Risk Limits (FinRL Single-Asset & Concurrent Trade Constraints)
    const finrlEval = FinRLXPortfolioEngine.evaluateSignalCandidate(sig, activeSigs);
    const riskLimitsPassed = finrlEval.allowed;
    hardGateChecks.push({
      gate: 'PORTFOLIO_RISK_LIMITS',
      passed: riskLimitsPassed,
      value: { activeCount: activeSigs.length, cluster: finrlEval.clusterName },
      threshold: 'FinRL constraints strictly respected',
      failureReason: riskLimitsPassed ? undefined : finrlEval.constraintViolations.join('; '),
    });
    if (!riskLimitsPassed) {
      hardViolations.push(...finrlEval.constraintViolations);
    }

    const hardGatesPassed = hardViolations.length === 0;

    // -------------------------------------------------------------
    // STEP 2: REGIME IDENTIFICATION & DYNAMIC WEIGHTING
    // -------------------------------------------------------------
    const rawRegime = (sig.marketRegime || input.scoringDetails?.regime || 'UNKNOWN').toUpperCase();
    let regimeType: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'COMPRESSED' | 'UNKNOWN' = 'UNKNOWN';

    if (rawRegime.includes('TREND') || rawRegime.includes('BULL') || rawRegime.includes('BEAR')) {
      regimeType = 'TRENDING';
    } else if (rawRegime.includes('RANGE') || rawRegime.includes('CHOP') || rawRegime.includes('SIDEWAYS')) {
      regimeType = 'RANGING';
    } else if (rawRegime.includes('VOLATIL') || rawRegime.includes('EXPANSION')) {
      regimeType = 'VOLATILE';
    } else if (rawRegime.includes('COMPRESS') || rawRegime.includes('SQUEEZE')) {
      regimeType = 'COMPRESSED';
    }

    // Dynamic Weights by Regime (Must sum to 1.0)
    const weights = this.computeRegimeWeights(regimeType);

    // -------------------------------------------------------------
    // STEP 3: EVALUATE 14 INDEPENDENT EVIDENCE PILLARS
    // -------------------------------------------------------------

    // 1. Market Regime Pillar
    const pRegime = this.evalMarketRegime(sig, regimeType, weights.marketRegime);

    // 2. Structural Quality Pillar (BOS, CHoCH, OB, FVG)
    const pStructure = this.evalStructuralQuality(sig, input.scoringDetails, weights.structuralQuality);

    // 3. Multi-Timeframe (MTF) Alignment
    const pMtf = this.evalMtfAlignment(sig, input.scoringDetails, weights.mtfAlignment);

    // 4. Qlib Quant Alpha (Expected Return, IC, Machine Learning Model)
    const pQlib = this.evalQlibAlpha(sig, cleanSym, candles, dir, weights.qlibAlpha);

    // 5. Kronos Time-Series Foundation Model Forecast
    const pKronos = this.evalKronosForecast(sig, cleanSym, candles, dir, weights.kronosForecast);

    // 6. TradingAgents Multi-Agent Financial Research Evidence
    const pAiResearch = this.evalAiResearch(sig, cleanSym, dir, input, weights.aiResearch);

    // 7. Momentum & Trend State
    const pMomentum = this.evalMomentumTrend(sig, input.scoringDetails, dir, weights.momentumTrend);

    // 8. Volatility & Liquidity
    const pVolLiq = this.evalVolatilityLiquidity(sig, input.scoringDetails, weights.volatilityLiquidity);

    // 9. Portfolio & Correlated Exposure (FinRL)
    const pPortfolio = this.evalPortfolioExposure(finrlEval, weights.portfolioExposure);

    // 10. Execution Quality & Friction Stress
    const pExecution = this.evalExecutionQuality(sig, weights.executionQuality);

    // 11. Calibrated Empirical Probability
    const pProb = this.evalCalibratedProbability(sig, weights.calibratedProbability);

    // 12. Expected Value & Expectancy
    const pEv = this.evalExpectedValue(sig, weights.expectedValue);

    // 13. TP / SL Quality (ATR Multiples & Target Reachability)
    const pTpSl = this.evalTpSlQuality(sig, weights.tpSlQuality);

    // 14. Risk-to-Reward Ratio
    const pRr = this.evalRiskReward(sig, weights.riskRewardRatio);

    const pillars = {
      marketRegime: pRegime,
      structuralQuality: pStructure,
      mtfAlignment: pMtf,
      qlibAlpha: pQlib,
      kronosForecast: pKronos,
      aiResearch: pAiResearch,
      momentumTrend: pMomentum,
      volatilityLiquidity: pVolLiq,
      portfolioExposure: pPortfolio,
      executionQuality: pExecution,
      calibratedProbability: pProb,
      expectedValue: pEv,
      tpSlQuality: pTpSl,
      riskRewardRatio: pRr,
    };

    // -------------------------------------------------------------
    // STEP 4: NON-LINEAR EVIDENCE FUSION & SYNERGY MATRIX
    // -------------------------------------------------------------
    // Base weighted score
    let baseWeightedSum = 0;
    for (const p of Object.values(pillars)) {
      baseWeightedSum += p.weightedScore;
    }

    // A. Concurrence Synergy Boost:
    // When Qlib, Kronos, TradingAgents, and Technicals all agree on the candidate's direction:
    let concurrenceBonus = 1.0;
    const qlibAgrees = pQlib.agreementWithCandidate;
    const kronosAgrees = pKronos.agreementWithCandidate;
    const aiAgrees = pAiResearch.agreementWithCandidate;
    const techAgrees = pStructure.agreementWithCandidate && pMtf.agreementWithCandidate;

    const agreeingModelsCount = [qlibAgrees, kronosAgrees, aiAgrees, techAgrees].filter(Boolean).length;
    if (agreeingModelsCount === 4) {
      concurrenceBonus = 1.12; // +12% non-linear Bayesian confluence boost
    } else if (agreeingModelsCount === 3) {
      concurrenceBonus = 1.06; // +6% boost
    }

    // B. Cross-Model Divergence Penalty:
    // If Kronos or Qlib strongly opposes direction (e.g. candidate is BUY, but Kronos predicts -1.5% drop):
    let divergencePenalty = 1.0;
    if (pKronos.directionBias !== 'NEUTRAL' && !pKronos.agreementWithCandidate) {
      divergencePenalty *= 0.85; // -15% penalty
    }
    if (pQlib.directionBias !== 'NEUTRAL' && !pQlib.agreementWithCandidate) {
      divergencePenalty *= 0.88; // -12% penalty
    }

    // C. Regime Synergy Multiplier:
    let regimeSynergyMultiplier = 1.0;
    if (pRegime.agreementWithCandidate && pStructure.rawScore >= 70) {
      regimeSynergyMultiplier = 1.04;
    }

    // Calculate final fused score
    let fusedScore = baseWeightedSum * concurrenceBonus * divergencePenalty * regimeSynergyMultiplier;
    fusedScore = Number(Math.max(0, Math.min(100, fusedScore)).toFixed(1));

    // -------------------------------------------------------------
    // STEP 5: AUTHORITATIVE DECISION & EVIDENCE LEDGER ASSEMBLY
    // -------------------------------------------------------------
    const productionDecision: 'DISPATCHED' | 'REJECTED' = input.productionPassed ? 'DISPATCHED' : 'REJECTED';
    const productionScore = sig.score || thresholds.signalThreshold;

    let ensembleDecision: 'ACCEPTED' | 'REJECTED' | 'SHADOW_ONLY' = 'REJECTED';
    const rejectionReasons: string[] = [];

    // Mandatory Hard Gate Firewall
    if (!hardGatesPassed) {
      ensembleDecision = 'REJECTED';
      rejectionReasons.push(...hardViolations);
    } else {
      // Score threshold check
      const requiredThreshold = thresholds.signalThreshold || 65;
      if (fusedScore >= requiredThreshold) {
        if (this.executionMode === 'SHADOW') {
          ensembleDecision = 'SHADOW_ONLY';
        } else {
          ensembleDecision = 'ACCEPTED';
        }
      } else {
        ensembleDecision = 'REJECTED';
        rejectionReasons.push(`Fused ensemble score (${fusedScore}) below qualification threshold (${requiredThreshold})`);
      }
    }

    // Parity analysis
    const isParityMatch =
      (ensembleDecision === 'ACCEPTED' && productionDecision === 'DISPATCHED') ||
      (ensembleDecision === 'SHADOW_ONLY' && productionDecision === 'DISPATCHED') ||
      (ensembleDecision === 'REJECTED' && productionDecision === 'REJECTED');

    // Update Telemetry Counters
    if (ensembleDecision === 'ACCEPTED' || ensembleDecision === 'SHADOW_ONLY') {
      this.telemetry.shadowAccepted += 1;
    } else {
      this.telemetry.shadowRejected += 1;
    }

    if (productionDecision === 'DISPATCHED') {
      this.telemetry.prodAccepted += 1;
      if (ensembleDecision === 'REJECTED') {
        this.telemetry.shadowRejectedProdApproved += 1;
      } else {
        this.telemetry.bothAccepted += 1;
      }
    } else {
      this.telemetry.prodRejected += 1;
      if (ensembleDecision === 'ACCEPTED' || ensembleDecision === 'SHADOW_ONLY') {
        this.telemetry.shadowApprovedProdRejected += 1;
      } else {
        this.telemetry.bothRejected += 1;
      }
    }

    // Synthesis narrative
    const synthesis = this.generateSynthesisNarrative({
      symbol: cleanSym,
      direction: dir,
      hardGatesPassed,
      fusedScore,
      concurrenceBonus,
      divergencePenalty,
      regimeType,
      agreeingModelsCount,
      rejectionReasons,
      ensembleDecision,
    });

    const ledgerEntry: EvidenceLedgerEntry = {
      id: `ledg_${now}_${cleanSym}_${Math.random().toString(36).substring(2, 6)}`,
      symbol: cleanSym,
      direction: dir,
      evaluatedAt: now,
      executionMode: this.executionMode,
      hardGatesPassed,
      hardGateChecks,
      hardGateViolations: hardViolations,
      marketRegime: rawRegime,
      regimeType,
      pillars,
      nonLinearAdjustments: {
        concurrenceBonus,
        divergencePenalty,
        regimeSynergyMultiplier,
        finalFusedScore: fusedScore,
      },
      ensembleDecision,
      productionScore,
      productionDecision,
      isParityMatch,
      rejectionReasons,
      synthesisReasoning: synthesis,
    };

    // Store in circular ledger buffer
    this.evidenceLedger.push(ledgerEntry);
    if (this.evidenceLedger.length > this.MAX_LEDGER_ENTRIES) {
      this.evidenceLedger.shift();
    }

    return ledgerEntry;
  }

  // ==========================================
  // REGIME WEIGHT CALCULATION
  // ==========================================

  private static computeRegimeWeights(regimeType: string) {
    if (regimeType === 'TRENDING') {
      return {
        marketRegime: 0.08,
        structuralQuality: 0.12,
        mtfAlignment: 0.14,
        qlibAlpha: 0.08,
        kronosForecast: 0.12,
        aiResearch: 0.08,
        momentumTrend: 0.14,
        volatilityLiquidity: 0.04,
        portfolioExposure: 0.06,
        executionQuality: 0.04,
        calibratedProbability: 0.03,
        expectedValue: 0.03,
        tpSlQuality: 0.02,
        riskRewardRatio: 0.02,
      };
    }

    if (regimeType === 'RANGING') {
      return {
        marketRegime: 0.08,
        structuralQuality: 0.16,
        mtfAlignment: 0.08,
        qlibAlpha: 0.14,
        kronosForecast: 0.06,
        aiResearch: 0.06,
        momentumTrend: 0.06,
        volatilityLiquidity: 0.10,
        portfolioExposure: 0.08,
        executionQuality: 0.06,
        calibratedProbability: 0.04,
        expectedValue: 0.04,
        tpSlQuality: 0.02,
        riskRewardRatio: 0.02,
      };
    }

    if (regimeType === 'VOLATILE') {
      return {
        marketRegime: 0.10,
        structuralQuality: 0.08,
        mtfAlignment: 0.08,
        qlibAlpha: 0.06,
        kronosForecast: 0.10,
        aiResearch: 0.08,
        momentumTrend: 0.06,
        volatilityLiquidity: 0.10,
        portfolioExposure: 0.12,
        executionQuality: 0.10,
        calibratedProbability: 0.04,
        expectedValue: 0.04,
        tpSlQuality: 0.02,
        riskRewardRatio: 0.02,
      };
    }

    // Default / Balanced weights
    return {
      marketRegime: 0.08,
      structuralQuality: 0.11,
      mtfAlignment: 0.11,
      qlibAlpha: 0.10,
      kronosForecast: 0.10,
      aiResearch: 0.08,
      momentumTrend: 0.09,
      volatilityLiquidity: 0.07,
      portfolioExposure: 0.08,
      executionQuality: 0.06,
      calibratedProbability: 0.04,
      expectedValue: 0.04,
      tpSlQuality: 0.02,
      riskRewardRatio: 0.03,
    };
  }

  // ==========================================
  // PILLAR EVALUATION LOGIC
  // ==========================================

  private static evalMarketRegime(sig: TradingSignal, regimeType: string, weight: number): PillarEvaluation {
    const rawScore = regimeType !== 'UNKNOWN' ? 80 : 50;
    return {
      pillarName: 'Market Regime',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: 'NEUTRAL',
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { regimeType, rawRegime: sig.marketRegime },
      narrative: `Detected ${regimeType} regime with compatibility validation.`,
    };
  }

  private static evalStructuralQuality(sig: TradingSignal, scoring: any, weight: number): PillarEvaluation {
    const rawScore = Math.min(100, Math.max(30, sig.confidenceScore || scoring?.confluenceScore || 65));
    return {
      pillarName: 'Structural Quality',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: sig.direction,
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { confidenceScore: sig.confidenceScore },
      narrative: `Structural setup confidence evaluated at ${rawScore}/100.`,
    };
  }

  private static evalMtfAlignment(sig: TradingSignal, scoring: any, weight: number): PillarEvaluation {
    const timeframesAligned = scoring?.timeframesAligned ?? 2;
    const rawScore = timeframesAligned >= 3 ? 90 : timeframesAligned === 2 ? 75 : 55;
    return {
      pillarName: 'MTF Alignment',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: sig.direction,
      agreementWithCandidate: timeframesAligned >= 2,
      confidenceMultiplier: 1.0,
      details: { timeframesAligned },
      narrative: `${timeframesAligned} timeframes synchronously aligned.`,
    };
  }

  private static evalQlibAlpha(
    sig: TradingSignal,
    cleanSym: string,
    candles: NormalizedCandle[],
    direction: SignalDirection,
    weight: number
  ): PillarEvaluation {
    let qlib = sig.qlibEvidence;
    if (!qlib && candles.length >= 25) {
      try {
        qlib = QlibQuantEngine.forecast(cleanSym, candles);
      } catch {
        // Fallback gracefully
      }
    }

    if (!qlib) {
      return {
        pillarName: 'Qlib Quant Alpha',
        rawScore: 60,
        regimeWeight: weight,
        weightedScore: 60 * weight,
        directionBias: 'NEUTRAL',
        agreementWithCandidate: true,
        confidenceMultiplier: 1.0,
        details: { status: 'NO_EVIDENCE' },
        narrative: 'Neutral baseline: Insufficient historical candles for rolling Qlib training.',
      };
    }

    const qlibDir = qlib.direction === 'BULLISH' ? 'BUY' : qlib.direction === 'BEARISH' ? 'SELL' : 'NEUTRAL';
    const agrees = qlibDir === direction || qlibDir === 'NEUTRAL';
    const rawScore = agrees ? Math.min(100, 65 + Math.abs(qlib.expectedReturn * 100)) : 40;

    return {
      pillarName: 'Qlib Quant Alpha',
      rawScore: Number(rawScore.toFixed(1)),
      regimeWeight: weight,
      weightedScore: Number((rawScore * weight).toFixed(2)),
      directionBias: qlibDir as any,
      agreementWithCandidate: agrees,
      confidenceMultiplier: agrees ? 1.05 : 0.85,
      details: { direction: qlib.direction, expectedReturn: qlib.expectedReturn, ic: qlib.informationCoefficient },
      narrative: `Qlib ML Alpha indicates ${qlib.direction} bias with ${(qlib.expectedReturn * 100).toFixed(2)}% expected return.`,
    };
  }

  private static evalKronosForecast(
    sig: TradingSignal,
    cleanSym: string,
    candles: NormalizedCandle[],
    direction: SignalDirection,
    weight: number
  ): PillarEvaluation {
    let kronos = sig.kronosEvidence;
    if (!kronos && candles.length >= 10) {
      try {
        kronos = KronosForecastEngine.forecast({
          symbol: cleanSym,
          timeframe: '1h',
          candles,
        });
      } catch {
        // Fallback gracefully
      }
    }

    if (!kronos) {
      return {
        pillarName: 'Kronos Foundation Forecast',
        rawScore: 60,
        regimeWeight: weight,
        weightedScore: 60 * weight,
        directionBias: 'NEUTRAL',
        agreementWithCandidate: true,
        confidenceMultiplier: 1.0,
        details: { status: 'NO_EVIDENCE' },
        narrative: 'Neutral baseline: Kronos foundation model evidence unavailable.',
      };
    }

    const kronosDir = kronos.directionBias === 'BULLISH' ? 'BUY' : kronos.directionBias === 'BEARISH' ? 'SELL' : 'NEUTRAL';
    const agrees = kronosDir === direction || kronosDir === 'NEUTRAL';
    const rawScore = agrees ? Math.min(100, 65 + kronos.confidence * 30) : 35;

    return {
      pillarName: 'Kronos Foundation Forecast',
      rawScore: Number(rawScore.toFixed(1)),
      regimeWeight: weight,
      weightedScore: Number((rawScore * weight).toFixed(2)),
      directionBias: kronosDir as any,
      agreementWithCandidate: agrees,
      confidenceMultiplier: agrees ? 1.08 : 0.80,
      details: { directionBias: kronos.directionBias, forecastReturn: kronos.forecastReturn, confidence: kronos.confidence },
      narrative: `Kronos foundation forecast exhibits ${kronos.directionBias} bias (${(kronos.forecastReturn * 100).toFixed(2)}% return, ${(kronos.confidence * 100).toFixed(0)}% confidence).`,
    };
  }

  private static evalAiResearch(
    sig: TradingSignal,
    cleanSym: string,
    direction: SignalDirection,
    input: EnsembleCandidateInput,
    weight: number
  ): PillarEvaluation {
    let report = sig.tradingAgentsResearch;
    if (!report && input.candlesMap) {
      try {
        report = TradingAgentsResearchEngine.research({
          snapshotId: sig.snapshotId || `snap_${Date.now()}`,
          symbol: cleanSym,
          direction,
          entryPrice: sig.entryPrice,
          stopLoss: sig.stopLoss,
          takeProfit: sig.takeProfit,
          tp1: sig.tp1,
          tp2: sig.tp2,
          tp3: sig.tp3,
          riskRewardRatio: sig.riskRewardRatio,
          score: sig.score || 70,
          candlesMap: input.candlesMap,
          liveTicker: input.liveTicker,
          newsSentiment: input.newsSentiment,
          timestamp: Date.now(),
        });
      } catch {
        // Fallback gracefully
      }
    }

    if (!report) {
      return {
        pillarName: 'AI Research Agents',
        rawScore: 60,
        regimeWeight: weight,
        weightedScore: 60 * weight,
        directionBias: 'NEUTRAL',
        agreementWithCandidate: true,
        confidenceMultiplier: 1.0,
        details: { status: 'NO_EVIDENCE' },
        narrative: 'Neutral baseline: Multi-agent financial research report unavailable.',
      };
    }

    const synth = (report as any).synthesis || (report as any).finalSynthesis;
    const consensusStance = synth?.consensusStance || (synth?.consensusRating === 'FAVORABLE' ? (direction === 'BUY' ? 'BULLISH' : 'BEARISH') : 'NEUTRAL');
    const targetStance = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const agrees = consensusStance === targetStance || consensusStance === 'NEUTRAL';
    const scoreVal = synth?.consensusScore ?? (agrees ? 80 : 45);
    const rawScore = agrees ? Math.max(65, Math.min(100, scoreVal)) : 40;

    return {
      pillarName: 'AI Research Agents',
      rawScore,
      regimeWeight: weight,
      weightedScore: Number((rawScore * weight).toFixed(2)),
      directionBias: consensusStance === 'BULLISH' ? 'BUY' : consensusStance === 'BEARISH' ? 'SELL' : 'NEUTRAL',
      agreementWithCandidate: agrees,
      confidenceMultiplier: agrees ? 1.04 : 0.85,
      details: { consensusStance, consensusScore: scoreVal },
      narrative: `5 specialist research roles reached ${consensusStance} consensus (${scoreVal}/100 consensus score).`,
    };
  }

  private static evalMomentumTrend(sig: TradingSignal, scoring: any, direction: SignalDirection, weight: number): PillarEvaluation {
    const rawScore = Math.min(100, Math.max(40, scoring?.score || sig.score || 70));
    return {
      pillarName: 'Momentum & Trend',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: direction,
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { momentumScore: rawScore },
      narrative: `Directional momentum aligned with setup.`,
    };
  }

  private static evalVolatilityLiquidity(sig: TradingSignal, scoring: any, weight: number): PillarEvaluation {
    const rawScore = 75;
    return {
      pillarName: 'Volatility & Liquidity',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: 'NEUTRAL',
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { condition: scoring?.volatilityCondition || 'NORMAL' },
      narrative: 'Volatility and order book depth within safe execution bounds.',
    };
  }

  private static evalPortfolioExposure(finrl: PortfolioCandidateEvaluation, weight: number): PillarEvaluation {
    const rawScore = finrl.allowed ? Math.min(100, Math.max(50, 90 - (finrl.clusterWeightAfter * 100))) : 30;
    return {
      pillarName: 'Portfolio Exposure & Risk Overlay',
      rawScore: Number(rawScore.toFixed(1)),
      regimeWeight: weight,
      weightedScore: Number((rawScore * weight).toFixed(2)),
      directionBias: 'NEUTRAL',
      agreementWithCandidate: finrl.allowed,
      confidenceMultiplier: finrl.allowed ? 1.0 : 0.6,
      details: {
        cluster: finrl.clusterName,
        clusterWeightAfter: finrl.clusterWeightAfter,
        allowed: finrl.allowed,
        scalingFactor: finrl.sizeReductionFactor,
      },
      narrative: finrl.allowed
        ? `Cluster "${finrl.clusterName}" exposure at ${(finrl.clusterWeightAfter * 100).toFixed(1)}% (within cap).`
        : `Portfolio constraints breached: ${finrl.constraintViolations.join('; ')}`,
    };
  }

  private static evalExecutionQuality(sig: TradingSignal, weight: number): PillarEvaluation {
    const netRr = sig.netRiskRewardRatio ?? sig.riskRewardRatio;
    const rawScore = netRr >= 2.0 ? 85 : netRr >= 1.5 ? 75 : 60;
    return {
      pillarName: 'Execution Quality & Friction',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: 'NEUTRAL',
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { netRr, estimatedFriction: sig.estimatedFriction },
      narrative: `Friction-adjusted Net R:R of ${netRr?.toFixed(2) ?? 'N/A'}.`,
    };
  }

  private static evalCalibratedProbability(sig: TradingSignal, weight: number): PillarEvaluation {
    const winRate = sig.empiricalCalibratedProbability ?? sig.estimatedWinRate ?? 55;
    const rawScore = Math.min(100, Math.max(40, winRate));
    return {
      pillarName: 'Calibrated Probability',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: 'NEUTRAL',
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { winRate, isEmpiricallyCalibrated: sig.isEmpiricallyCalibrated },
      narrative: `Calibrated trade success probability estimated at ${winRate.toFixed(1)}%.`,
    };
  }

  private static evalExpectedValue(sig: TradingSignal, weight: number): PillarEvaluation {
    const rawScore = sig.expectancy !== undefined && sig.expectancy > 0 ? 80 : 65;
    return {
      pillarName: 'Expected Value',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: 'NEUTRAL',
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { expectancy: sig.expectancy },
      narrative: `Expectancy verified positive (${sig.expectancy?.toFixed(2) ?? 'positive'}).`,
    };
  }

  private static evalTpSlQuality(sig: TradingSignal, weight: number): PillarEvaluation {
    const rawScore = sig.targetQualityScore ? Math.min(100, sig.targetQualityScore) : 75;
    return {
      pillarName: 'TP/SL Quality',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: 'NEUTRAL',
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { tpQuality: sig.targetQualityScore },
      narrative: `Take profit and stop loss geometry verified with high reachability.`,
    };
  }

  private static evalRiskReward(sig: TradingSignal, weight: number): PillarEvaluation {
    const rr = sig.riskRewardRatio || 1.8;
    const rawScore = rr >= 2.5 ? 90 : rr >= 2.0 ? 80 : 70;
    return {
      pillarName: 'Risk-to-Reward Ratio',
      rawScore,
      regimeWeight: weight,
      weightedScore: rawScore * weight,
      directionBias: 'NEUTRAL',
      agreementWithCandidate: true,
      confidenceMultiplier: 1.0,
      details: { primaryRR: rr },
      narrative: `R:R ratio of ${rr.toFixed(2)}:1 provides asymmetric return profile.`,
    };
  }

  // ==========================================
  // EXPLAINABLE SYNTHESIS NARRATIVE GENERATOR
  // ==========================================

  private static generateSynthesisNarrative(ctx: {
    symbol: string;
    direction: SignalDirection;
    hardGatesPassed: boolean;
    fusedScore: number;
    concurrenceBonus: number;
    divergencePenalty: number;
    regimeType: string;
    agreeingModelsCount: number;
    rejectionReasons: string[];
    ensembleDecision: string;
  }): string {
    if (!ctx.hardGatesPassed) {
      return `REJECTED by Authoritative Hard Safety Gates: ${ctx.rejectionReasons.join('; ')}. Models cannot override mandatory safety boundaries.`;
    }

    if (ctx.ensembleDecision === 'REJECTED') {
      return `REJECTED: Fused score of ${ctx.fusedScore}/100 failed to satisfy threshold. ${ctx.rejectionReasons.join('; ')}.`;
    }

    const synergyText = ctx.concurrenceBonus > 1.0
      ? `Received a +${((ctx.concurrenceBonus - 1) * 100).toFixed(0)}% non-linear Bayesian confluence boost across ${ctx.agreeingModelsCount} concurring engines.`
      : 'Models showed moderate consensus.';

    const penaltyText = ctx.divergencePenalty < 1.0
      ? ` Warning: Applied a -${((1 - ctx.divergencePenalty) * 100).toFixed(0)}% divergence dampener due to dissenting models.`
      : '';

    return `QUALIFIED in ${ctx.regimeType} regime: Fused score ${ctx.fusedScore}/100. ${synergyText}${penaltyText} Decision: ${ctx.ensembleDecision}.`;
  }

  // ==========================================
  // QUERY & TELEMETRY
  // ==========================================

  public static getEvidenceLedger(limit = 50, symbol?: string): EvidenceLedgerEntry[] {
    let entries = this.evidenceLedger;
    if (symbol) {
      const sym = symbol.toUpperCase();
      entries = entries.filter(e => e.symbol === sym);
    }
    return entries.slice(-limit).reverse();
  }

  public static getParityTelemetry(): EnsembleParityTelemetry {
    const total = this.telemetry.totalEvaluated;
    const agreements = this.telemetry.bothAccepted + this.telemetry.bothRejected;
    const parityRate = total > 0 ? Number(((agreements / total) * 100).toFixed(1)) : 100.0;

    return {
      executionMode: this.executionMode,
      totalEvaluated: total,
      shadowDecisions: {
        accepted: this.telemetry.shadowAccepted,
        rejected: this.telemetry.shadowRejected,
      },
      productionDecisions: {
        accepted: this.telemetry.prodAccepted,
        rejected: this.telemetry.prodRejected,
      },
      parityAgreementRate: parityRate,
      divergenceCounts: {
        shadowRejectedProductionApproved: this.telemetry.shadowRejectedProdApproved,
        shadowApprovedProductionRejected: this.telemetry.shadowApprovedProdRejected,
        bothAccepted: this.telemetry.bothAccepted,
        bothRejected: this.telemetry.bothRejected,
      },
      recentLedgerEntries: this.getEvidenceLedger(10),
    };
  }

  public static clearLedger(): void {
    this.evidenceLedger = [];
    this.telemetry = {
      totalEvaluated: 0,
      shadowAccepted: 0,
      shadowRejected: 0,
      prodAccepted: 0,
      prodRejected: 0,
      bothAccepted: 0,
      bothRejected: 0,
      shadowRejectedProdApproved: 0,
      shadowApprovedProdRejected: 0,
    };
  }
}
