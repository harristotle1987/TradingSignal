import { TradingSignal, SignalGenerationResponse, NormalizedCandle, NormalizedTicker, SignalDirection } from '../../types/index.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { quotaManager } from '../market/QuotaManager.js';
import { MarketSessionManager } from '../market/MarketSessionManager.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { ScoringEngine } from './ScoringEngine.js';
import { Gate0DataValidator } from './Gate0DataValidator.js';
import { serverConfig } from '../config.js';
import { Gate1MarketRegime } from './Gate1MarketRegime.js';
import { Gate2MTFConfluence } from './Gate2MTFConfluence.js';
import { Gate3MarketStructure } from './Gate3MarketStructure.js';
import { Gate3PreliminaryScreen, Gate3PreliminaryScreenResult } from './Gate3PreliminaryScreen.js';
import { Gate4RequestBudget, Gate4BudgetEvaluation } from './Gate4RequestBudget.js';
import { Gate5DeepCandidateSelection, Gate5CandidateInput, Gate5SelectionResult, Gate5RankedCandidate } from './Gate5DeepCandidateSelection.js';
import { Gate6ProgressiveMTF, Gate6CandidateEvaluation, Gate6ProgressiveAnalysisResult } from './Gate6ProgressiveMTF.js';
import { Gate7FinalTradeValidation, Gate7ValidationResult } from './Gate7FinalTradeValidation.js';
import { Gate8TradeabilityThreshold, Gate8EvaluationResult, Gate8EvaluationInput } from './Gate8TradeabilityThreshold.js';
import { Gate9FinalSignalCap, Gate9CapSelectionResult } from './Gate9FinalSignalCap.js';
import { Gate10ScannerTelemetry, Gate10ScanTelemetryData, Gate10CandidateScoreRecord } from './Gate10ScannerTelemetry.js';
import { marketCache } from '../market/CacheStore.js';
import { Gate4MomentumVolatility } from './Gate4MomentumVolatility.js';
import { Gate5SupportResistance } from './Gate5Liquidity.js';
import { Gate6VolumePriceAction } from './Gate6VolumePriceAction.js';
import { Gate7MarketContext } from './Gate7MarketContext.js';
import { Gate8EntryQuality } from './Gate8EntryQuality.js';
import { Gate9RiskManagement } from './Gate9RiskManagement.js';
import { Gate12Divergence } from './Gate12Divergence.js';
import { Gate13BreakoutQuality } from './Gate13BreakoutQuality.js';
import { Gate14PullbackQuality } from './Gate14PullbackQuality.js';
import { Gate15LiquiditySweep } from './Gate15LiquiditySweep.js';
import { Gate16RelativeStrength } from './Gate16RelativeStrength.js';
import { Gate17CorrelationExposure } from './Gate17CorrelationExposure.js';
import { Gate18RegimeStrategySelection } from './Gate18RegimeStrategySelection.js';
import { Gate20ProbabilityCalibration } from './Gate20ProbabilityCalibration.js';
import { Gate21WalkForwardValidation } from './Gate21WalkForwardValidation.js';
import { Gate32AdaptiveCandidateSelection, Stage2CandidateInput } from './Gate32AdaptiveCandidateSelection.js';
import { TargetQualityEvaluator, calculateTargetRr } from './TargetQualityEvaluator.js';
import { RiskRewardCalculator } from './RiskRewardCalculator.js';
import { Gate22MonteCarloSimulation } from './Gate22MonteCarloSimulation.js';
import { NvidiaAIService, CandidateAnalysisPayload } from './NvidiaAIService.js';
import { SignalValidator } from './SignalValidator.js';
import { TradeRankingEngine, ValidatedCandidate } from './TradeRankingEngine.js';
import { SignalLogger } from './SignalLogger.js';
import { SignalFingerprint } from './SignalFingerprint.js';
import { CooldownManager } from './CooldownManager.js';
import { MarketStructureDetector } from './MarketStructureDetector.js';
import { SignalAuditStore } from './SignalAuditStore.js';
import { ScannerPersistence } from './ScannerPersistence.js';
import { Gate35SignalFunnelAnalytics } from './Gate35SignalFunnelAnalytics.js';
import { Gate31NewsRiskClassification } from './Gate31NewsRiskClassification.js';
import { OpportunityFunnelStore } from './Gate26OpportunityFunnel.js';
import { CandidateRejectionTracker, StandardFailedGate } from './CandidateRejectionTracker.js';
import { ScanPerformanceProfiler, setActiveProfiler } from './ScanPerformanceProfiler.js';
import { logger } from '../logger.js';
import { getDynamicPrecision } from '../../utils/formatters.js';

function decimals(price: number, symbol?: string): number {
  return getDynamicPrecision(price, symbol);
}

function getEmptyTelemetry(
  universeLen: number,
  s0: number,
  s1: number,
  timingInfo?: {
    globalScanStartMs?: number;
    globalScanDeadlineMs?: number;
    globalScanSoftDeadlineMs?: number;
    currentElapsedMs?: number;
    remainingBudgetMs?: number;
    gate6ElapsedMs?: number;
    stage3ElapsedMs?: number;
    timeBudgetExceeded?: boolean;
    providerRequestsStoppedByBudget?: boolean;
    executionId?: string;
  }
) {
  return {
    universeSymbolsScanned: universeLen,
    preliminaryCandidatesFound: s1,
    candidatesRejectedPreliminary: universeLen - s1,
    candidatesEvaluated: 0,
    candidatesRejectedFinal: 0,
    signalsGenerated: 0,
    signalsAccepted: 0,
    stage0Input: universeLen, stage0Output: s0,
    stage1Input: s0, stage1Output: s1,
    quotaGateInput: s1, quotaGateOutput: 0,
    preRankInput: 0, preRankOutput: 0,
    deepMtfInput: 0, deepMtfOutput: 0,
    finalValidationInput: 0, finalValidationOutput: 0,
    finalScoreGateInput: 0, finalScoreGateOutput: 0,
    globalScanStartMs: timingInfo?.globalScanStartMs ?? 0,
    globalScanDeadlineMs: timingInfo?.globalScanDeadlineMs ?? 0,
    globalScanSoftDeadlineMs: timingInfo?.globalScanSoftDeadlineMs ?? 0,
    currentElapsedMs: timingInfo?.currentElapsedMs ?? 0,
    remainingBudgetMs: timingInfo?.remainingBudgetMs ?? 0,
    gate6ElapsedMs: timingInfo?.gate6ElapsedMs ?? 0,
    stage3ElapsedMs: timingInfo?.stage3ElapsedMs ?? 0,
    timeBudgetExceeded: timingInfo?.timeBudgetExceeded ?? false,
    providerRequestsStoppedByBudget: timingInfo?.providerRequestsStoppedByBudget ?? false,
    executionId: timingInfo?.executionId ?? '',
    scanId: timingInfo?.executionId ?? '',
  };
}

export async function runStagedPipeline(
  engine: any,
  symbol: string,
  category?: string,
  persistAndActivate: boolean = true,
  options?: { scanStartedAt?: number; globalScanBudgetMs?: number; executionId?: string }
): Promise<SignalGenerationResponse> {
  const cleanSymbol = symbol.trim().toUpperCase();
  const now = Date.now();
  const globalScanStartMs = options?.scanStartedAt ?? Date.now();
  const GLOBAL_SCAN_BUDGET_MS = options?.globalScanBudgetMs ?? 17500;
  const globalScanDeadlineMs = globalScanStartMs + GLOBAL_SCAN_BUDGET_MS;
  const globalScanSoftDeadlineMs = globalScanStartMs + Math.min(16000, Math.max(0, GLOBAL_SCAN_BUDGET_MS - 1500));
  const executionId = options?.executionId ?? `scan-${globalScanStartMs}-${Math.random().toString(36).substring(2, 9)}`;
  const scanStartTime = globalScanStartMs;
  let timeBudgetExceeded = false;
  let providerRequestsStoppedByBudget = false;
  let gate6ElapsedMs = 0;
  let stage3ElapsedMs = 0;
  const initialSessionRequests = quotaManager.getTotalSessionRequestsAll();
  const initialErrors = quotaManager.getTotalRecentErrors();
  const initialTimeouts = quotaManager.getTotalRecentTimeouts();
  let gate7FailuresCount = 0;
  const allCandidateScores: Gate10CandidateScoreRecord[] = [];
  const { assetCategory, universe } = engine.resolveTargetUniverse(cleanSymbol, category);

  const profiler = new ScanPerformanceProfiler(executionId);
  profiler.startScan(globalScanStartMs);
  profiler.setGlobalDeadline(globalScanDeadlineMs);
  setActiveProfiler(profiler);

  const getTimingSnapshot = (extraStoppedByBudget = false) => ({
    globalScanStartMs,
    globalScanDeadlineMs,
    globalScanSoftDeadlineMs,
    currentElapsedMs: Date.now() - globalScanStartMs,
    remainingBudgetMs: Math.max(0, globalScanDeadlineMs - Date.now()),
    gate6ElapsedMs,
    stage3ElapsedMs,
    timeBudgetExceeded: timeBudgetExceeded || (Date.now() >= globalScanDeadlineMs),
    providerRequestsStoppedByBudget: providerRequestsStoppedByBudget || extraStoppedByBudget || (profiler.getStoppedByBudgetCount() > 0),
    executionId,
  });

  // 1. Check duplicate / active signal cooldown
  const existingSignal = engine.activeSignals.get(cleanSymbol);
  if (existingSignal && now - existingSignal.timestamp < 8 * 60 * 1000) {
    logger.info('Returning existing active signal within cooldown window', { symbol: cleanSymbol, id: existingSignal.id, snapshotId: existingSignal.snapshotId });
    profiler.endScan();
    setActiveProfiler(null);
    return {
      success: true,
      message: `Active signal retrieved for ${cleanSymbol} (Snapshot ${existingSignal.snapshotId})`,
      symbol: cleanSymbol,
      marketPrice: existingSignal.entryPrice,
      signal: existingSignal,
      timestamp: now,
    };
  }

  logger.info(`================================================================`);
  logger.info(`[Multi-Asset Scanner] Initiating Staged Scan for [${assetCategory}] universe across ${universe.length} symbols...`);
  logger.info(`================================================================`);

  // Helper for structured audit logging to avoid code duplication
  const logAuditHelper = (asset: string, scoring: any, primaryStrategyName: string, crossCheck: any, fp: string, reason: string, status: 'REJECTED' | 'WATCHING' | 'CANDIDATE' | 'ACCEPTED' = 'REJECTED') => {
    SignalAuditStore.logAudit({
      symbol: asset,
      direction: scoring?.direction || 'BUY',
      timeframe: 'Multi-TF Realism Setup',
      primaryStrategy: primaryStrategyName,
      passedStrategies: scoring?.passedStrategies || [],
      failedStrategies: scoring?.failedStrategies || [],
      marketRegime: scoring?.marketRegime || 'UNKNOWN',
      atr: scoring?.technicalMetrics?.atr || 0,
      dataFreshnessSeconds: 0,
      providerAgreement: crossCheck ? crossCheck.agreementPct >= 99.5 : true,
      providerAgreementPct: crossCheck ? crossCheck.agreementPct : 100,
      expectedRR: scoring?.riskRewardRatio || 0,
      score: scoring?.score || 0,
      status,
      rejectionReason: status === 'REJECTED' ? reason : null,
      fingerprint: fp,
    });
  };

  try {
    // -----------------------------------------------------------------
    // STAGE 0: Cached/Session Screening
    // -----------------------------------------------------------------
    profiler.startStage('Stage 0: Session Screening', universe.length);
    const openAssets = universe.filter((asset) => MarketSessionManager.getSessionState(asset) === 'MARKET_OPEN');
    const stage0OutputCount = openAssets.length;
    profiler.endStage('Stage 0: Session Screening', stage0OutputCount);

    logger.info(`[Stage 0: Cached/session screening] Input: ${universe.length} assets, Output: ${stage0OutputCount} active/open assets`);

    if (openAssets.length === 0) {
      logger.info(`[Multi-Asset Scanner] All assets in ${assetCategory} universe are MARKET CLOSED.`);
      profiler.setFunnelMetrics({ preliminaryCandidates: 0, deepCandidates: 0, MTFCandidates: 0, signalsGenerated: 0, signalsAccepted: 0 });
      profiler.endScan();
      setActiveProfiler(null);
      return {
        success: false,
        message: 'MARKET CLOSED',
        symbol: cleanSymbol,
        reason: `All instruments in the ${assetCategory} universe are currently outside official exchange trading hours.`,
        timestamp: now,
        telemetry: getEmptyTelemetry(universe.length, 0, 0, getTimingSnapshot()),
      };
    }

    // -----------------------------------------------------------------
    // GATE 3: CHEAP PRELIMINARY SCREEN
    // -----------------------------------------------------------------
    profiler.startStage('Gate 3: Preliminary Screening', stage0OutputCount);
    const stage2Candidates: Array<{
      asset: string;
      htf1h: NormalizedCandle[];
      preliminaryScore: number;
      direction: SignalDirection;
      gate3Result?: Gate3PreliminaryScreenResult;
    }> = [];

    const BATCH_SIZE = 16;
    for (let i = 0; i < openAssets.length; i += BATCH_SIZE) {
      const remainingMs = globalScanDeadlineMs - Date.now();
      if (remainingMs <= 1500 || Date.now() >= globalScanSoftDeadlineMs) {
        if (remainingMs <= 0) timeBudgetExceeded = true;
        providerRequestsStoppedByBudget = true;
        logger.warn(`[Gate 3 Time Budget Exceeded] Global scan budget reached (${Date.now() - globalScanStartMs}ms elapsed, remaining: ${remainingMs}ms). Halting further preliminary screening.`);
        break;
      }
      const batch = openAssets.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (asset) => {
          let htf1h: NormalizedCandle[];
          try {
            htf1h = await marketDataManager.getCandles(asset, undefined, '1h', 50, false, globalScanDeadlineMs);
          } catch (err) {
            logger.info(`[Gate 3 Screen] Skipped ${asset}: 1H candles unavailable (${err instanceof Error ? err.message : String(err)})`);
            return null;
          }

          if (!htf1h || htf1h.length < 15) return null;

          const gate0 = Gate0DataValidator.validate({
            symbol: asset,
            timeframe: '1h',
            liveTicker: null,
            candles: htf1h,
            minCandlesRequired: 15
          });

          if (gate0.dataStatus !== 'VALID') return null;

          const gate3 = Gate3PreliminaryScreen.screenAsset(asset, htf1h);
          const isManualQuery = universe.length === 1;

          // Gate 3 Routing: <60 rejected (stops processing), 60+ preliminary or strong preliminary candidate
          if (isManualQuery || gate3.passed) {
            logger.info(`[Gate 3 Passed] ${asset} -> Routing: ${gate3.routing}, Score: ${gate3.preliminaryScore}/100, Direction: ${gate3.direction}`);
            return {
              asset,
              htf1h,
              preliminaryScore: isManualQuery ? Math.max(60, gate3.preliminaryScore) : gate3.preliminaryScore,
              direction: gate3.direction,
              gate3Result: gate3,
            };
          } else {
            logger.debug?.(`[Gate 3 Rejected] ${asset} -> Score: ${gate3.preliminaryScore}/100 (< 60 threshold), Reason: ${gate3.reason}`);
          }
          return null;
        })
      );

      for (const res of batchResults) {
        if (res) stage2Candidates.push(res);
      }
    }

    const stage1OutputCount = stage2Candidates.length;
    profiler.endStage('Gate 3: Preliminary Screening', stage1OutputCount);
    logger.info(`[Gate 3: Cheap preliminary screening] Input: ${stage0OutputCount} assets, Output: ${stage1OutputCount} surviving candidates (Target: ~30-45)`);

    if (stage1OutputCount === 0) {
      profiler.setFunnelMetrics({ preliminaryCandidates: 0, deepCandidates: 0, MTFCandidates: 0, signalsGenerated: 0, signalsAccepted: 0 });
      profiler.endScan();
      setActiveProfiler(null);
      return {
        success: false,
        message: 'NO QUALIFIED TRADE',
        symbol: cleanSymbol,
        reason: `No symbols passed Gate 3 preliminary screening criteria (Liquidity, Volume, Trend, Momentum, Volatility, Spread).`,
        timestamp: now,
        telemetry: getEmptyTelemetry(universe.length, stage0OutputCount, 0, getTimingSnapshot()),
      };
    }

    // -----------------------------------------------------------------
    // GATE 4: PROVIDER QUOTA / REQUEST BUDGET GATE
    // Before any expensive analysis, evaluate provider request budgets.
    // Dynamic deep budget: HIGH (12), NORMAL (10), LOW (8), CRITICAL (4), EXHAUSTED (0).
    // Never consumes reserved quota; gracefully halts deeper analysis if exhausted.
    // -----------------------------------------------------------------
    const gate4Budget = Gate4RequestBudget.evaluateBudget(assetCategory);

    if (!gate4Budget.passed || gate4Budget.maxDeepCandidates <= 0) {
      logger.warn(`[Gate 4 Budget Exhausted] ${gate4Budget.reason}`);
      profiler.setStoppedByBudget(true);
      profiler.setFunnelMetrics({ preliminaryCandidates: stage1OutputCount, deepCandidates: 0, MTFCandidates: 0, signalsGenerated: 0, signalsAccepted: 0 });
      profiler.endScan();
      setActiveProfiler(null);
      return {
        success: false,
        message: 'NO QUALIFIED TRADE',
        symbol: cleanSymbol,
        reason: `Dynamic provider request budget is exhausted. Deeper MTF analysis gracefully skipped to protect API quotas.`,
        timestamp: now,
        telemetry: getEmptyTelemetry(universe.length, stage0OutputCount, stage1OutputCount, getTimingSnapshot(true)),
      };
    }

    // -----------------------------------------------------------------
    // GATE 5: DEEP CANDIDATE SELECTION
    // -----------------------------------------------------------------
    profiler.startStage('Gate 5: Deep Candidate Selection', stage1OutputCount);
    const gate5Inputs: Gate5CandidateInput[] = stage2Candidates.map((c) => ({
      asset: c.asset,
      htf1h: c.htf1h,
      preliminaryScore: c.preliminaryScore,
      direction: c.direction,
      gate3Result: c.gate3Result,
    }));

    const gate5Selection = Gate5DeepCandidateSelection.selectCandidates(
      gate5Inputs,
      gate4Budget.maxDeepCandidates
    );

    const selectedDeepCandidates = gate5Selection.selectedCandidates;
    const gate5OutputCount = selectedDeepCandidates.length;
    profiler.endStage('Gate 5: Deep Candidate Selection', gate5OutputCount);

    logger.info(
      `[Gate 5 Deep Candidate Selection] Input: ${stage1OutputCount} preliminary candidates -> Output: ${gate5OutputCount} selected deep candidates (Budget Cap: ${gate4Budget.maxDeepCandidates}, Health: ${gate4Budget.overallBudgetHealth})`
    );

    if (gate5OutputCount === 0) {
      profiler.setFunnelMetrics({ preliminaryCandidates: stage1OutputCount, deepCandidates: 0, MTFCandidates: 0, signalsGenerated: 0, signalsAccepted: 0 });
      profiler.endScan();
      setActiveProfiler(null);
      return {
        success: false,
        message: 'NO QUALIFIED TRADE',
        symbol: cleanSymbol,
        reason: `No candidates qualified during Gate 5 deep candidate selection.`,
        timestamp: now,
        telemetry: getEmptyTelemetry(universe.length, stage0OutputCount, stage1OutputCount, getTimingSnapshot()),
      };
    }

    // -----------------------------------------------------------------
    // STAGE 2: Progressive Deep MTF Analysis (Gate 6)
    // Progressively evaluates the 8–12 candidates to find the TOP 3–5 full analysis candidates.
    // Layer 1 (15m & 1h) early-terminates on disagreement without fetching 5m/4h.
    // Layer 2 (5m & 4h) validates ATR, S&R, and structure on survivors.
    // -----------------------------------------------------------------
    const rejectionTracker = new CandidateRejectionTracker();

    const gate6Inputs = selectedDeepCandidates.map((cand) => ({
      asset: cand.asset,
      direction: cand.direction,
      htf1h: cand.htf1h,
      preliminaryScore: cand.preliminaryScore,
    }));

    profiler.startStage('Gate 6 Layer 1: MTF 15m/1h', gate6Inputs.length);
    const gate6Analysis = await Gate6ProgressiveMTF.analyzeCandidates(
      gate6Inputs,
      5,
      globalScanStartMs,
      globalScanDeadlineMs
    );
    profiler.endStage('Gate 6 Layer 1: MTF 15m/1h', gate6Analysis.survivedCandidates.length);

    profiler.startStage('Gate 6 Layer 2: MTF 5m/4h', gate6Analysis.survivedCandidates.length);

    gate6ElapsedMs = gate6Analysis.gate6ElapsedMs;
    if (gate6Analysis.timeBudgetExceeded) timeBudgetExceeded = true;
    if (gate6Analysis.providerRequestsStoppedByBudget) providerRequestsStoppedByBudget = true;

    // Record Gate 6 rejections in Funnel Analytics and Audit Store
    for (const rej of gate6Analysis.rejectedCandidates) {
      const reason = rej.rejectionReason || `Gate 6 Layer ${rej.stoppedAtLayer} MTF Analysis Rejected`;
      logger.info(`[Stage 2 Gate 6 Rejected] ${rej.asset}: ${reason}`);

      const failedGates: StandardFailedGate[] = [];
      const lowerReason = reason.toLowerCase();

      if (rej.stoppedAtLayer === 'BEFORE_MTF' || lowerReason.includes('final_score_unreachable')) {
        failedGates.push(StandardFailedGate.FINAL_SCORE_UNREACHABLE);
        failedGates.push(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
      } else {
        failedGates.push(StandardFailedGate.MTF_ALIGNMENT);
        if (lowerReason.includes('atr') || lowerReason.includes('volatility')) {
          failedGates.push(StandardFailedGate.VOLATILITY);
        }
        if (lowerReason.includes('structure') || lowerReason.includes('s&r') || lowerReason.includes('support')) {
          failedGates.push(StandardFailedGate.MARKET_STRUCTURE);
        }
        const sigThreshold = serverConfig.getConfig().thresholds.signalThreshold;
        if (rej.compositeMtfScore < sigThreshold || rej.finalScore < sigThreshold) {
          failedGates.push(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
        }
      }

      rejectionTracker.recordCandidate({
        symbol: rej.asset,
        direction: rej.direction,
        score: rej.compositeMtfScore || 0,
        primaryRejectionReason: `Gate 6 (MTF Layer ${rej.stoppedAtLayer}): ${reason}`,
        failedGates,
        finalDecision: 'REJECTED',
        stage: rej.stoppedAtLayer === 'BEFORE_MTF' ? 'Gate 6 Pre-Audit' : 'GATE_6',
        scoreBeforeGate6: rej.scoreBeforeGate6,
        maximumPossibleScoreAfterRemainingAnalysis: rej.maximumPossibleScoreAfterRemainingAnalysis,
        scoreAfterGate6: rej.scoreAfterGate6,
        finalScore: rej.finalScore,
        factors: rej.factors,
      });

      Gate35SignalFunnelAnalytics.recordCandidate({
        symbol: rej.asset,
        direction: rej.direction,
        stage: 'GATE_6',
        score: rej.compositeMtfScore || 0,
        regime: 'UNKNOWN',
        strategy: 'Progressive MTF Confluence',
        rejectionReason: reason,
        assetClass: SymbolNormalizer.getAssetClassification(rej.asset),
        initialScore: rej.compositeMtfScore || 0,
        watchingThreshold: serverConfig.getConfig().thresholds.watchingThreshold,
        qualifiedCandidateThreshold: serverConfig.getConfig().thresholds.qualifiedCandidateThreshold,
        signalThreshold: serverConfig.getConfig().thresholds.signalThreshold,
        strategyAgreementRatio: 0,
        timeframeAlignmentRatio: 0,
        grossRR: 0,
        netRR: 0,
        adverseNetRR: 0,
        estimatedWinRate: 0,
        empiricalProbability: null,
        probabilitySampleSize: 0,
        aiMode: 'None',
        aiResult: 'None',
        dataFreshness: '0s',
        entryQuality: 'Unqualified',
        newsStatus: 'Neutral',
        correlationCluster: Gate17CorrelationExposure.identifyCluster(rej.asset).name,
        finalDecision: 'REJECTED',
        rejectionStage: 'GATE_6',
      });
      logAuditHelper(rej.asset, { score: rej.compositeMtfScore, direction: rej.direction } as any, 'Progressive MTF Confluence', { verified: false, agreementPct: 100 }, `fp_g6_${rej.asset}`, reason);
    }

    const deepAnalyzedCandidates: any[] = [];
    const stage3StartMs = Date.now();
    let generalNews: any[] = [];
    const remainingBeforeNews = globalScanDeadlineMs - Date.now();
    if (remainingBeforeNews > 1500 && Date.now() < globalScanSoftDeadlineMs) {
      generalNews = await engine.fetchGeneralNews();
    } else {
      if (remainingBeforeNews <= 0) timeBudgetExceeded = true;
      providerRequestsStoppedByBudget = true;
    }
    const thresholds = serverConfig.getConfig().thresholds;

    // Parallelize live price & cross-source verification for all survived candidates
    const survivedPricesAndCrossChecks = await Promise.all(
      gate6Analysis.survivedCandidates.map(async (gate6Cand) => {
        const remainingMs = globalScanDeadlineMs - Date.now();
        if (remainingMs <= 1000 || Date.now() >= globalScanSoftDeadlineMs) {
          providerRequestsStoppedByBudget = true;
          return null;
        }
        const asset = gate6Cand.asset;
        const candlesMap = gate6Cand.candlesMap;
        const sorted1h = candlesMap['1h'] || [];
        const lastCandle = sorted1h[sorted1h.length - 1];
        if (!lastCandle || lastCandle.close <= 0) return null;

        try {
          // Sync verified news from Twelve Data for this candidate (cache-first/non-blocking)
          await Gate31NewsRiskClassification.syncVerifiedNews(asset, Math.min(200, Math.max(0, remainingMs)));

          const liveTicker = await marketDataManager.getPrice(asset, undefined, true, 'AUTOMATED_SCANNER', globalScanDeadlineMs);
          if (!liveTicker || liveTicker.price <= 0) return null;
          const baselinePrice = liveTicker.price;
          const newsSentiment = engine.evaluateNewsSentiment(asset, generalNews);
          const crossCheck = await engine.verifyCrossSourcePrice(asset, baselinePrice, globalScanDeadlineMs);
          return { gate6Cand, liveTicker, baselinePrice, newsSentiment, crossCheck };
        } catch {
          return null;
        }
      })
    );

    for (const item of survivedPricesAndCrossChecks) {
      if (!item) continue;
      const { gate6Cand, liveTicker, baselinePrice, newsSentiment, crossCheck } = item;
      const remainingMs = globalScanDeadlineMs - Date.now();
      if (remainingMs <= 0) {
        timeBudgetExceeded = true;
        providerRequestsStoppedByBudget = true;
        logger.warn(`[Stage 3 Time Budget Exceeded] Global scan deadline reached (${Date.now() - globalScanStartMs}ms elapsed). Returning candidates evaluated so far.`);
        break;
      }
      const asset = gate6Cand.asset;
      const candlesMap = gate6Cand.candlesMap;

      let allDataValid = true;
      let dataFreshnessSeconds = 0;
      for (const [tf, candles] of Object.entries(candlesMap)) {
        const gate0 = Gate0DataValidator.validate({
          symbol: asset,
          timeframe: tf,
          liveTicker,
          candles,
          secondaryPrice: crossCheck.secondaryPrice ? { price: crossCheck.secondaryPrice, source: crossCheck.source2 || 'Secondary' } : undefined,
          minCandlesRequired: 10
        });
        if (gate0.dataStatus !== 'VALID') {
          allDataValid = false;
          break;
        }
        dataFreshnessSeconds = Math.max(dataFreshnessSeconds, gate0.freshnessSec);
      }

      if (!allDataValid) continue;

      const gate1 = Gate1MarketRegime.detectRegime(asset, candlesMap);
      const scoring = ScoringEngine.calculateScore(asset, baselinePrice, candlesMap, newsSentiment.sentiment, crossCheck.agreementPct);

      if (scoring.isValid && scoring.direction) {
        const setupCandles = candlesMap['15m'] || candlesMap['1h'] || candlesMap['5m'] || [];
        const gate12 = setupCandles.length >= 25 ? Gate12Divergence.analyze(setupCandles, scoring.direction) : { confirmed: false, score: 50, direction: 'NONE' as const, type: 'NONE' as const, strength: 'NONE' as const, summary: '', reasons: [] as string[] };
        const gate13 = setupCandles.length >= 25 ? Gate13BreakoutQuality.analyze(setupCandles, scoring.direction) : { breakoutQuality: 'UNCONFIRMED_BREAKOUT', breakoutScore: 0, breakoutType: 'NONE', retestStatus: 'NONE', volumeConfirmation: 'NONE', reasons: [] as string[] };
        const gate14 = setupCandles.length >= 25 ? Gate14PullbackQuality.analyze(setupCandles, scoring.direction) : { pullbackQuality: 'NONE', pullbackScore: 0, pullbackDepth: 0, structurePreserved: false, reversalRisk: 'NONE', reasons: [] as string[] };
        const gate15 = setupCandles.length >= 25 ? Gate15LiquiditySweep.analyze(setupCandles, scoring.direction) : { confirmationStatus: 'UNCONFIRMED', sweepDirection: 'NONE', sweepLevel: 0, sweepStrength: 0, sweepScore: 0, reasons: [] as string[] };

        const gate2 = Gate2MTFConfluence.evaluateConfluence(scoring.direction, candlesMap);
        const gate3 = Gate3MarketStructure.analyzeStructure(scoring.direction, setupCandles);
        const gate4 = Gate4MomentumVolatility.analyze(scoring.direction, setupCandles);
        const gate5 = Gate5SupportResistance.analyze(scoring.direction, setupCandles);
        const gate6 = Gate6VolumePriceAction.analyze(scoring.direction, setupCandles);
        const gate7 = Gate7MarketContext.analyze(asset, scoring.direction, setupCandles);
        const gate8 = Gate8EntryQuality.analyze(baselinePrice, scoring.direction, setupCandles);

        // Defensive guard: scoring.stopLoss/tp1/tp2/tp3/riskRewardRatio are
        // typed number|undefined upstream. If SL/TP generation failed
        // earlier in ScoringEngine for any reason, fail loudly here rather
        // than passing undefined into Gate9RiskManagement (which requires
        // strict numbers) or silently treating it as 0.
        if (
          scoring.stopLoss === undefined ||
          scoring.tp1 === undefined ||
          scoring.tp2 === undefined ||
          scoring.tp3 === undefined ||
          scoring.riskRewardRatio === undefined
        ) {
          scoring.isValid = false;
          scoring.rejectionReason = 'REJECTED: SL_TP_GENERATION_FAILED. Stop-loss/take-profit values were not generated prior to risk evaluation.';
          continue;
        }

        const gate9 = Gate9RiskManagement.calculate(
          baselinePrice,
          scoring.direction,
          scoring.stopLoss,
          scoring.tp1,
          scoring.tp2,
          scoring.tp3,
          scoring.riskRewardRatio
        );

        if (gate12.direction !== 'NONE' && gate12.reasons) scoring.confluenceReasons.push(...gate12.reasons);
        if (gate13.breakoutQuality !== 'UNCONFIRMED_BREAKOUT' && gate13.reasons) scoring.confluenceReasons.push(...gate13.reasons);
        if (gate14.reasons) scoring.confluenceReasons.push(...gate14.reasons);
        if (gate15.confirmationStatus !== 'UNCONFIRMED' && gate15.reasons) scoring.confluenceReasons.push(...gate15.reasons);

        const isDirBullish = scoring.direction === 'BUY';
        const isDirBearish = scoring.direction === 'SELL';
        const trendPass = gate2.confluenceStatus !== 'CONTRADICTION' && gate2.alignmentScore >= 40;
        const structurePass = gate3.score >= 40 || (isDirBullish && gate3.direction === 'BULLISH') || (isDirBearish && gate3.direction === 'BEARISH');
        const momentumPass = gate4.score >= 40 || (isDirBullish && gate4.momentumDirection === 'BULLISH') || (isDirBearish && gate4.momentumDirection === 'BEARISH');

        // Gate 91: Pathways
        const hasStrongTrend = gate2.alignmentScore >= 50 && gate2.confluenceStatus !== 'CONTRADICTION';
        const hasValidEntry = gate8.entryScore >= 40 || (gate8.entryQuality !== 'OVEREXTENDED' && gate8.entryQuality !== 'WAIT_FOR_PULLBACK' && gate8.chaseRisk !== 'EXTREME');
        const hasGoodRR = gate9.rrRatio >= thresholds.minimumRR;
        const isStrongTrendPath = hasStrongTrend && hasValidEntry && hasGoodRR;
        const isGoodBreakoutPath = (gate13.breakoutScore >= 45 || (scoring.marketRegime as string) === 'BREAKOUT') && structurePass && hasGoodRR;
        const isGoodReversalPath = (gate12.confirmed || gate15.confirmationStatus === 'CONFIRMED_SWEEP') && structurePass && gate9.riskScore >= 40;
        const isGoodMomentumPath = (gate4.score >= 45 || momentumPass) && hasValidEntry && gate9.riskScore >= 40;

        const anyOptimizedPathPassed = isStrongTrendPath || isGoodBreakoutPath || isGoodReversalPath || isGoodMomentumPath;
        const hasDirectionalConfirmation = anyOptimizedPathPassed || ((trendPass ? 1 : 0) + (structurePass ? 1 : 0) + (momentumPass ? 1 : 0) >= 2);

        (scoring as any).anyOptimizedPathPassed = anyOptimizedPathPassed;

        if (gate7.tradingAllowed === 'NO') {
          scoring.isValid = false;
          scoring.rejectionReason = `REJECTED: MARKET_CONTEXT_BLOCKED. ${gate7.reasons.join('; ')}`;
        } else if (gate9.rrRatio < thresholds.minimumRR) {
          scoring.isValid = false;
          scoring.rejectionReason = `REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross R:R (${gate9.rrRatio.toFixed(2)}) below ${thresholds.minimumRR}`;
        } else {
          const compositeScore = Math.round(
            gate2.alignmentScore * 0.25 +
            gate3.score * 0.20 +
            gate4.score * 0.20 +
            (gate4.volatilityState === 'DEAD' || gate4.volatilityState === 'ERRATIC' ? 20 : 85) * 0.15 +
            gate6.score * 0.10 +
            gate6Cand.compositeMtfScore * 0.10
          );

          scoring.score = Math.min(100, Math.max(scoring.score, compositeScore));

          if (scoring.score < thresholds.minimumScore) {
            scoring.isValid = false;
            scoring.rejectionReason = `REJECTED: SCORE_BELOW_THRESHOLD. Composite signal score ${scoring.score}/100 is below the minimum required threshold of ${thresholds.minimumScore}`;
          } else {
            // scoring.stopLoss/takeProfit/tp1/tp2/tp3/riskRewardRatio retain the values ScoringEngine originally produced
          }
        }
      }

      const primaryStrategyName = scoring.primaryStrategy || 'Multi-Timeframe Trend Confluence';
      const fp = SignalFingerprint.generateFingerprint({
        symbol: asset,
        direction: scoring.direction || 'BUY',
        entryPrice: baselinePrice,
        timeframe: 'Multi-TF Realism Setup',
        primaryStrategy: primaryStrategyName,
        atr: scoring.technicalMetrics?.atr,
      });

      const commonTelemetry = {
        assetClass: SymbolNormalizer.getAssetClassification(asset),
        initialScore: gate6Cand.compositeMtfScore,
        watchingThreshold: thresholds.watchingThreshold,
        qualifiedCandidateThreshold: thresholds.qualifiedCandidateThreshold,
        signalThreshold: thresholds.signalThreshold,
        strategyAgreementRatio: scoring.strategyAgreementRatio,
        timeframeAlignmentRatio: scoring.timeframeAlignmentRatio,
        grossRR: scoring.riskRewardRatio,
        netRR: scoring.estimatedFriction?.netRiskRewardRatio,
        adverseNetRR: scoring.estimatedFriction?.adverseNetRiskRewardRatio,
        estimatedWinRate: scoring.estimatedWinRate,
        empiricalProbability: null,
        probabilitySampleSize: 0,
        aiMode: 'None',
        aiResult: 'None',
        dataFreshness: `${dataFreshnessSeconds}s`,
        entryQuality: scoring.isValid ? 'High Quality setup' : 'Unqualified',
        newsStatus: newsSentiment.sentiment,
        correlationCluster: Gate17CorrelationExposure.identifyCluster(asset).name,
        finalDecision: scoring.isValid ? 'QUALIFIED' : 'REJECTED',
        rejectionStage: scoring.isValid ? 'Passed' : 'GATE_3',
      };

      if (!scoring.isValid) {
        logger.info(`[Stage 2 Scoring] ${asset} rejected: ${scoring.rejectionReason}`);
        const failedGates = CandidateRejectionTracker.inferFailedGatesFromReason(scoring.rejectionReason || '', scoring.score);
        rejectionTracker.recordCandidate({
          symbol: asset,
          direction: scoring.direction,
          score: scoring.score || 0,
          primaryRejectionReason: scoring.rejectionReason || 'Stage 2 Scoring Hurdle Failed',
          failedGates,
          finalDecision: 'REJECTED',
          stage: 'STAGE_2_SCORING',
          entryPrice: scoring.entryPrice || baselinePrice,
          stopLoss: scoring.stopLoss,
          takeProfit: scoring.takeProfit,
          tp1: scoring.tp1,
          tp2: scoring.tp2,
          tp3: scoring.tp3,
          grossRR: scoring.grossRR ?? scoring.riskRewardRatio,
          primaryRR: scoring.primaryRR ?? scoring.riskRewardRatio,
          tp1RR: scoring.tp1RR,
          tp2RR: scoring.tp2RR,
          tp3RR: scoring.tp3RR,
          timestamp: now,
          factors: scoring.factors,
          tpDiagnostics: scoring.tpDiagnostics,
        });
        Gate35SignalFunnelAnalytics.recordCandidate({
          symbol: asset, direction: scoring.direction, stage: 'GATE_3', score: scoring.score || 0,
          regime: scoring.marketRegime || 'UNKNOWN', strategy: primaryStrategyName,
          rejectionReason: scoring.rejectionReason || 'Failed scoring criteria', ...commonTelemetry,
          finalDecision: 'REJECTED', rejectionStage: 'GATE_3'
        });
        logAuditHelper(asset, scoring, primaryStrategyName, crossCheck, fp, scoring.rejectionReason || 'Failed scoring criteria');
        continue;
      }

      deepAnalyzedCandidates.push({
        asset, candlesMap, liveTicker, baselinePrice, dataFreshnessSeconds,
        crossCheck, scoring, primaryStrategyName, fp, commonTelemetry
      });
    }

    stage3ElapsedMs = Date.now() - stage3StartMs;
    const deepMtfOutputCount = deepAnalyzedCandidates.length;
    profiler.endStage('Gate 6 Layer 2: MTF 5m/4h', deepMtfOutputCount);
    logger.info(`[Progressive deep MTF analysis] Input: ${gate6Inputs.length} candidates, Output: ${deepMtfOutputCount} passed deep analysis`);

    // -----------------------------------------------------------------
    // STAGE 3: Final Trade Validation (Gate 7 - 13 Mandatory Hard Gates)
    // -----------------------------------------------------------------
    profiler.startStage('Stage 3: Final Trade Validation', deepMtfOutputCount);
    const candidates: ValidatedCandidate[] = [];

    for (const candInfo of deepAnalyzedCandidates) {
      const {
        asset, candlesMap, liveTicker, baselinePrice, dataFreshnessSeconds,
        crossCheck, scoring, primaryStrategyName, fp, commonTelemetry
      } = candInfo;

      const secondaryPrice = crossCheck.secondaryPrice ? { price: crossCheck.secondaryPrice, source: crossCheck.source2 || 'Secondary' } : undefined;

      // Gate 7: Execute all 13 Mandatory Hard Gates
      const gate7Validation = Gate7FinalTradeValidation.validateCandidate({
        symbol: asset,
        direction: scoring.direction,
        entryPrice: baselinePrice,
        stopLoss: scoring.stopLoss,
        takeProfit: scoring.takeProfit,
        tp1: scoring.tp1,
        tp2: scoring.tp2,
        tp3: scoring.tp3,
        riskRewardRatio: scoring.riskRewardRatio,
        netRiskRewardRatio: scoring.estimatedFriction?.netRiskRewardRatio,
        score: scoring.score,
        candlesMap,
        liveTicker,
        atr: scoring.technicalMetrics?.atr,
        secondaryPrice,
        primaryStrategy: primaryStrategyName,
        marketRegime: scoring.marketRegime,
        activeSignals: engine.activeSignals,
        minimumRRThreshold: thresholds.minimumRR,
        minimumScoreThreshold: thresholds.signalThreshold,
      });

      if (!gate7Validation.isTradeable) {
        gate7FailuresCount++;
        const rejectionMsg = gate7Validation.primaryRejectionReason || 'Failed Gate 7 Mandatory Hard Gates';
        logger.warn(`[Gate 7 Hard Gates Rejected] ${asset}: ${rejectionMsg} (Failed: ${gate7Validation.failedGateCodes.join(', ')})`);

        const failedGates = CandidateRejectionTracker.mapGate7CodesToStandardGates(
          gate7Validation.failedGateCodes,
          rejectionMsg,
          scoring.score
        );

        rejectionTracker.recordCandidate({
          symbol: asset,
          direction: scoring.direction,
          score: scoring.score || 0,
          primaryRejectionReason: rejectionMsg,
          failedGates,
          finalDecision: 'REJECTED',
          stage: 'GATE_7',
          entryPrice: scoring.entryPrice || baselinePrice,
          stopLoss: scoring.stopLoss,
          takeProfit: scoring.takeProfit,
          tp1: scoring.tp1,
          tp2: scoring.tp2,
          tp3: scoring.tp3,
          grossRR: scoring.grossRR ?? scoring.riskRewardRatio,
          primaryRR: scoring.primaryRR ?? scoring.riskRewardRatio,
          tp1RR: scoring.tp1RR,
          tp2RR: scoring.tp2RR,
          tp3RR: scoring.tp3RR,
          timestamp: now,
          factors: scoring.factors,
          tpDiagnostics: scoring.tpDiagnostics,
        });

        Gate35SignalFunnelAnalytics.recordCandidate({
          symbol: asset,
          direction: scoring.direction,
          stage: 'GATE_7',
          score: scoring.score,
          regime: scoring.marketRegime,
          strategy: primaryStrategyName,
          rejectionReason: rejectionMsg,
          ...commonTelemetry,
          finalDecision: 'REJECTED',
          rejectionStage: 'GATE_7',
        });
        logAuditHelper(asset, scoring, primaryStrategyName, crossCheck, fp, `Gate 7 Validation Failed: ${rejectionMsg}`);
        continue;
      }

      const validation = SignalValidator.validate({
        symbol: asset, direction: scoring.direction, entryPrice: baselinePrice,
        stopLoss: scoring.stopLoss, takeProfit: scoring.takeProfit, tp1: scoring.tp1,
        tp2: scoring.tp2, tp3: scoring.tp3, riskRewardRatio: scoring.riskRewardRatio,
        score: scoring.score, candlesMap, liveTicker, secondaryPrice,
      });

      engine.logDiagnosticTrace(asset, liveTicker.price, crossCheck, { sentiment: commonTelemetry.newsStatus, reason: '' }, scoring, validation);

      if (!validation.isValid) {
        logger.warn(`[Stage 3 Validation Rejected] ${asset}: [${validation.validationReason}] ${validation.detailedMessage}`);
        const failedGates = CandidateRejectionTracker.inferFailedGatesFromReason(validation.detailedMessage || validation.validationReason, scoring.score);
        rejectionTracker.recordCandidate({
          symbol: asset,
          direction: scoring.direction,
          score: scoring.score || 0,
          primaryRejectionReason: `Signal Validation: [${validation.validationReason}] ${validation.detailedMessage}`,
          failedGates,
          finalDecision: 'REJECTED',
          stage: 'GATE_3_VALIDATION',
          entryPrice: validation.adjustedEntryPrice ?? scoring.entryPrice ?? baselinePrice,
          stopLoss: validation.adjustedStopLoss ?? scoring.stopLoss,
          takeProfit: validation.adjustedTakeProfit ?? scoring.takeProfit,
          tp1: validation.adjustedTp1 ?? scoring.tp1,
          tp2: validation.adjustedTp2 ?? scoring.tp2,
          tp3: validation.adjustedTp3 ?? scoring.tp3,
          grossRR: validation.adjustedGrossRR ?? scoring.grossRR ?? scoring.riskRewardRatio,
          primaryRR: validation.adjustedPrimaryRR ?? scoring.primaryRR ?? scoring.riskRewardRatio,
          tp1RR: validation.adjustedTp1RR ?? scoring.tp1RR,
          tp2RR: validation.adjustedTp2RR ?? scoring.tp2RR,
          tp3RR: validation.adjustedTp3RR ?? scoring.tp3RR,
          timestamp: now,
          factors: scoring.factors,
          tpDiagnostics: scoring.tpDiagnostics,
        });
        Gate35SignalFunnelAnalytics.recordCandidate({
          symbol: asset, direction: scoring.direction, stage: 'GATE_9', score: scoring.score,
          regime: scoring.marketRegime, strategy: primaryStrategyName,
          rejectionReason: validation.detailedMessage || validation.validationReason, ...commonTelemetry,
          finalDecision: 'REJECTED', rejectionStage: 'GATE_9'
        });
        logAuditHelper(asset, scoring, primaryStrategyName, crossCheck, fp, `Gate 8 Validation Failed [${validation.validationReason}]: ${validation.detailedMessage}`);
        continue;
      }

      let finalEntry = validation.adjustedEntryPrice || liveTicker.price;
      let finalSL = validation.adjustedStopLoss || scoring.stopLoss;
      let finalTP = validation.adjustedTakeProfit || scoring.takeProfit;
      const finalRR = validation.adjustedGrossRR ?? scoring.grossRR ?? scoring.riskRewardRatio;

      if (!scoring.technicalMetrics) continue;

      const candidatePayloadForAI = {
        hasSetup: true, symbol: asset, entryPrice: finalEntry, direction: scoring.direction,
        timeframe: '5m-1D Multi-TF Realism Check', strategy: primaryStrategyName,
        confluenceReasons: scoring.confluenceReasons, confidenceScore: scoring.score,
        stopLoss: finalSL, takeProfit: finalTP, riskRewardRatio: finalRR, technicalMetrics: scoring.technicalMetrics,
      };

      const winRate = ScoringEngine.estimateWinRate(scoring.score, finalRR, scoring.agreeingStrategiesCount);
      const expectancy = ScoringEngine.calculateExpectancy(winRate, finalRR);

      const anyOptimizedPathPassed = !!(scoring as any).anyOptimizedPathPassed;
      const effectiveMinWinProb = anyOptimizedPathPassed ? 35 : thresholds.minimumWinProbability;

      if (winRate <= effectiveMinWinProb) {
        const reason = `Estimated win rate (${winRate}% <= ${effectiveMinWinProb}% threshold)`;
        const failedGates: StandardFailedGate[] = [StandardFailedGate.WIN_RATE_BELOW_THRESHOLD];
        if ((scoring.score || 0) < thresholds.signalThreshold) {
          failedGates.push(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
        }
        if (finalRR < thresholds.minimumRR) {
          failedGates.push(StandardFailedGate.RR);
        }
        rejectionTracker.recordCandidate({
          symbol: asset,
          direction: scoring.direction,
          score: scoring.score || 0,
          primaryRejectionReason: reason,
          failedGates,
          finalDecision: 'REJECTED',
          stage: 'WIN_RATE_CHECK',
          entryPrice: finalEntry,
          stopLoss: finalSL,
          takeProfit: finalTP,
          tp1: scoring.tp1,
          tp2: scoring.tp2,
          tp3: scoring.tp3,
          timestamp: now,
          factors: scoring.factors,
          tpDiagnostics: scoring.tpDiagnostics,
        });
        logAuditHelper(asset, scoring, primaryStrategyName, crossCheck, fp, reason);
        continue;
      }

      if (expectancy <= 0) {
        const reason = `Non-positive expectancy (${expectancy}R <= 0)`;
        const failedGates: StandardFailedGate[] = [StandardFailedGate.NEGATIVE_EXPECTANCY];
        if ((scoring.score || 0) < thresholds.signalThreshold) {
          failedGates.push(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
        }
        if (finalRR < thresholds.minimumRR) {
          failedGates.push(StandardFailedGate.RR);
        }
        rejectionTracker.recordCandidate({
          symbol: asset,
          direction: scoring.direction,
          score: scoring.score || 0,
          primaryRejectionReason: reason,
          failedGates,
          finalDecision: 'REJECTED',
          stage: 'EXPECTANCY_CHECK',
          entryPrice: finalEntry,
          stopLoss: finalSL,
          takeProfit: finalTP,
          tp1: scoring.tp1,
          tp2: scoring.tp2,
          tp3: scoring.tp3,
          timestamp: now,
          factors: scoring.factors,
          tpDiagnostics: scoring.tpDiagnostics,
        });
        logAuditHelper(asset, scoring, primaryStrategyName, crossCheck, fp, reason);
        continue;
      }

      const classification = SymbolNormalizer.getAssetClassification(asset);

      // -----------------------------------------------------------------
      // STAGE 4: Gate 8 — Final Tradeability Threshold (10-Factor Rubric)
      // Configured tradeability threshold: >= thresholds.signalThreshold.
      // Factors: Trend 20, MTF 15, Momentum 10, Structure 15,
      // Volume 10, Volatility/ATR 10, Entry 5, R:R 5, Execution 5, Direction 5 = 100.
      // -----------------------------------------------------------------
      const gate8Eval = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: asset,
        direction: scoring.direction,
        trendAlignmentScore: scoring.factors?.higherTfTrendScore ? (scoring.factors.higherTfTrendScore / 20) * 100 : 75,
        mtfConfluenceScore: (scoring.timeframeAlignmentRatio ?? 0.75) * 100,
        momentumScore: scoring.factors?.momentumScore ? (scoring.factors.momentumScore / 15) * 100 : 75,
        marketStructureScore: scoring.factors?.marketStructureScore ? (scoring.factors.marketStructureScore / 15) * 100 : 75,
        volumeScore: scoring.factors?.volumeOrderFlowScore ? (scoring.factors.volumeOrderFlowScore / 15) * 100 : 70,
        volatilityAtrScore: scoring.factors?.volatilityAtrScore ? (scoring.factors.volatilityAtrScore / 10) * 100 : 80,
        entryQualityScore: scoring.factors?.entryQualityScore ? (scoring.factors.entryQualityScore / 10) * 100 : 75,
        riskRewardRatio: scoring.riskRewardRatio,
        netRiskRewardRatio: finalRR,
        agreeingStrategiesRatio: scoring.strategyAgreementRatio ?? 0.8,
        timeframeAlignmentRatio: scoring.timeframeAlignmentRatio ?? 0.75,
        frictionToProfitPct: scoring.estimatedFriction?.frictionToProfitPct,
      });

      allCandidateScores.push({
        symbol: asset,
        direction: scoring.direction,
        score: gate8Eval.finalScore,
        classification: gate8Eval.classification,
        passed: gate8Eval.isTradeable,
        rejectionReason: gate8Eval.rejectionReason,
        factors: gate8Eval.factors as any,
      });

      if (!gate8Eval.isTradeable) {
        const failedGates: StandardFailedGate[] = [];
        if (gate8Eval.finalScore < thresholds.signalThreshold) {
          failedGates.push(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
        }
        const factors: any = gate8Eval.factors || {};
        if (factors.trendAlignment !== undefined && factors.trendAlignment < 14) failedGates.push(StandardFailedGate.TREND);
        if (factors.momentum !== undefined && factors.momentum < 7) failedGates.push(StandardFailedGate.MOMENTUM);
        if (factors.marketStructure !== undefined && factors.marketStructure < 10) failedGates.push(StandardFailedGate.MARKET_STRUCTURE);
        if (factors.mtfConfirmation !== undefined && factors.mtfConfirmation < 10) failedGates.push(StandardFailedGate.MTF_ALIGNMENT);
        if (factors.volumeLiquidity !== undefined && factors.volumeLiquidity < 6) failedGates.push(StandardFailedGate.VOLUME);
        if (factors.volatilityAtrQuality !== undefined && factors.volatilityAtrQuality < 6) failedGates.push(StandardFailedGate.VOLATILITY);
        if (factors.entryQuality !== undefined && factors.entryQuality < 3.5) failedGates.push(StandardFailedGate.VALID_ENTRY);
        if (factors.rrQuality !== undefined && factors.rrQuality < 3.5) failedGates.push(StandardFailedGate.RR);

        if (failedGates.length === 0) {
          if (gate8Eval.finalScore < thresholds.signalThreshold) {
            failedGates.push(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
          } else {
            failedGates.push(StandardFailedGate.DATA_INTEGRITY);
          }
        }

        rejectionTracker.recordCandidate({
          symbol: asset,
          direction: scoring.direction,
          score: gate8Eval.finalScore,
          primaryRejectionReason: gate8Eval.rejectionReason || `Gate 8 Score (${gate8Eval.finalScore}/100) below ${thresholds.signalThreshold}`,
          failedGates,
          finalDecision: 'REJECTED',
          stage: 'GATE_8',
          entryPrice: finalEntry,
          stopLoss: finalSL,
          takeProfit: finalTP,
          tp1: scoring.tp1,
          tp2: scoring.tp2,
          tp3: scoring.tp3,
          timestamp: now,
          factors: gate8Eval.factors,
        });

        if (gate8Eval.classification === 'NEAR_MISS_WATCHLIST') {
          OpportunityFunnelStore.addOrUpdate({
            id: `opp_${now}_${asset}_${Math.random().toString(36).substring(2, 6)}`,
            symbol: asset, direction: scoring.direction, entryPrice: finalEntry,
            stopLoss: finalSL, takeProfit: finalTP, tp1: scoring.tp1, tp2: scoring.tp2, tp3: scoring.tp3,
            riskRewardRatio: finalRR, score: gate8Eval.finalScore, confidenceScore: gate8Eval.finalScore,
            stage: 'WATCHING', status: 'WATCHING',
            hardGatesPassed: true, passedSoftConditions: gate8Eval.confluenceHighlights,
            missingSoftConditions: [`Requires >= ${thresholds.signalThreshold} score (Current: ${gate8Eval.finalScore}/100)`],
            rejectionReason: gate8Eval.rejectionReason || `Placed on Watchlist (Score ${thresholds.watchingThreshold}–${thresholds.signalThreshold - 1})`,
            marketRegime: scoring.marketRegime,
            strategy: primaryStrategyName, createdAt: now, updatedAt: now, expiresAt: now + serverConfig.getConfig().signalExpirationMs,
          });
        }

        logAuditHelper(asset, scoring, primaryStrategyName, crossCheck, fp, gate8Eval.rejectionReason || `Score (${gate8Eval.finalScore}/100) below Gate 8 threshold (${thresholds.signalThreshold})`);
        continue;
      }

      const providerName = classification === 'CRYPTO' ? 'Bitget Live Feed' : (classification === 'FOREX' ? 'Twelve Data' : 'Finnhub');
      const precision = decimals(finalEntry, asset);
      const isForex = asset.includes('USD') && precision === 5;
      const isJPY = asset.includes('JPY');
      const multiplier = isForex ? 10000 : (isJPY ? 100 : 1);

      const targetDistance = Number((Math.abs(finalTP - finalEntry) * multiplier).toFixed(1));
      const stopDistance = Number((Math.abs(finalEntry - finalSL) * multiplier).toFixed(1));

      const priceShift = finalEntry - baselinePrice;
      const rawTp1 = scoring.tp1 !== undefined ? scoring.tp1 + priceShift : finalTP;
      const rawTp2 = scoring.tp2 !== undefined ? scoring.tp2 + priceShift : finalTP;
      const rawTp3 = scoring.tp3 !== undefined ? scoring.tp3 + priceShift : finalTP;

      const atr = scoring.technicalMetrics?.atr || 0;
      const tpEnforced = SignalValidator.validateAndEnforceTps(
        scoring.direction, finalEntry, finalSL, rawTp1, rawTp2, rawTp3, atr, precision, classification
      );

      const safeTp1 = tpEnforced.tp1;
      const safeTp2 = tpEnforced.tp2;
      const safeTp3 = tpEnforced.tp3;
      const safeTakeProfit = tpEnforced.takeProfit;

      const rrResult = RiskRewardCalculator.calculate(finalEntry, finalSL, safeTp1, safeTp2, safeTp3, scoring.direction);
      const tp1Rr = rrResult.tp1RR;
      const tp2Rr = rrResult.tp2RR;
      const tp3Rr = rrResult.tp3RR;
      const exactPrimaryRr = rrResult.primaryRR;

      const tqResult = TargetQualityEvaluator.evaluate({
        direction: scoring.direction, entryPrice: finalEntry, stopLoss: finalSL,
        tp1: safeTp1, tp2: safeTp2, tp3: safeTp3, atr, marketRegime: scoring.marketRegime,
      });

      scoring.score = gate8Eval.finalScore;

      const signal: TradingSignal = {
        id: `sig_${now}_${Math.random().toString(36).substring(2, 7)}`,
        snapshotId: validation.snapshotId, symbol: asset, direction: scoring.direction,
        entryPrice: finalEntry, timeframe: 'Multi-TF Realism Setup', strategy: primaryStrategyName,
        confluenceReasons: [...scoring.confluenceReasons, ...gate8Eval.confluenceHighlights],
        confidenceScore: gate8Eval.finalScore,
        targetQualityScore: tqResult.targetQualityScore, estimatedWinRate: winRate,
        modelEstimatedWinRate: winRate, empiricalCalibratedProbability: null,
        probabilitySourceUsed: serverConfig.getConfig().thresholds.probabilitySource,
        isEmpiricallyCalibrated: false, isAiValidated: false, stopLoss: finalSL,
        takeProfit: safeTakeProfit, tp1: safeTp1, tp2: safeTp2, tp3: safeTp3, tp1Rr, tp2Rr, tp3Rr,
        riskRewardRatio: exactPrimaryRr, grossRiskRewardRatio: scoring.estimatedFriction?.grossRiskRewardRatio ?? exactPrimaryRr,
        netRiskRewardRatio: scoring.estimatedFriction?.netRiskRewardRatio,
        adverseNetRiskRewardRatio: scoring.estimatedFriction?.adverseNetRiskRewardRatio,
        targetDistance, stopDistance, pipPointUnit: scoring.pipPointUnit, estimatedFriction: scoring.estimatedFriction,
        suggestedRiskAmount: scoring.hypotheticalRisk.suggestedRiskAmount,
        suggestedPositionSize: scoring.hypotheticalRisk.suggestedPositionSize,
        expiresAt: now + serverConfig.getConfig().signalExpirationMs, timestamp: now,
        validatedAt: validation.validatedAt, dataSource: `${providerName} with Live Price & Sentiment Cross-Validation`,
        status: 'WAITING_ENTRY', isActionableSignal: true, validationReason: 'VALID',
        aiAssessment: 'Pending NVIDIA AI comparative ranking...', score: gate8Eval.finalScore, coreScore: gate8Eval.finalScore,
        factors: gate8Eval.factors || scoring.factors,
        entryHitTimestamp: null, tp1Status: 'PENDING', tp2Status: 'PENDING', tp3Status: 'PENDING', slStatus: 'ACTIVE_FOR_ENTRY_ONLY',
      };

      candidates.push({
        signal, scoring, validation, aiConfidence: undefined,
        timeframesAligned: scoring.timeframesAligned,
        candles: candlesMap['1h'] || candlesMap['15m'] || candlesMap['5m'] || [],
      });
    }

    const filteredCandidates = [...candidates];

    // -----------------------------------------------------------------
    // GATE 3: NVIDIA AI BATCH CANDIDATE ANALYSIS & RANKING
    // Send structured data of top 3-5 candidates to NVIDIA API.
    // AI compares, detects risks, ranks strongest to weakest, returns 0-3 recommendations.
    // -----------------------------------------------------------------
    if (filteredCandidates.length > 0 && thresholds.AIConfirmationMode !== 'DISABLED') {
      const candidatePayloads: CandidateAnalysisPayload[] = filteredCandidates.slice(0, 5).map((c) => ({
        hasSetup: true,
        symbol: c.signal.symbol,
        entryPrice: c.signal.entryPrice,
        direction: c.signal.direction,
        timeframe: c.signal.timeframe,
        strategy: c.signal.strategy,
        confluenceReasons: c.signal.confluenceReasons,
        confidenceScore: c.signal.score || c.signal.confidenceScore,
        stopLoss: c.signal.stopLoss,
        takeProfit: c.signal.takeProfit,
        riskRewardRatio: c.signal.riskRewardRatio,
        technicalMetrics: c.scoring.technicalMetrics,
        marketRegime: c.signal.marketRegime,
        winRateEstimate: c.signal.estimatedWinRate,
      }));

      const batchAiResult = await NvidiaAIService.evaluateAndRankBatch(candidatePayloads, globalScanDeadlineMs);
      logger.info(`[NVIDIA AI Batch Analysis] ${batchAiResult.aiAssessment}`, {
        recommendedCount: batchAiResult.recommendedSymbols.length,
      });

      for (const cand of filteredCandidates) {
        const rankInfo = batchAiResult.rankings.find((r) => r.symbol === cand.signal.symbol);
        if (rankInfo) {
          cand.signal.aiAssessment = `NVIDIA AI Rank #${rankInfo.rank} [${rankInfo.isRecommended ? 'RECOMMENDED' : 'CAUTION'}]: ${rankInfo.reasoning}${rankInfo.detectedRisks && rankInfo.detectedRisks !== 'None' ? ` (Risks: ${rankInfo.detectedRisks})` : ''}`;
          cand.signal.isAiValidated = rankInfo.isRecommended;
          (cand.signal as any).aiRank = rankInfo.rank;
          (cand.signal as any).aiRiskNote = rankInfo.detectedRisks;
        } else {
          cand.signal.aiAssessment = batchAiResult.aiAssessment;
        }
      }

      if (batchAiResult.classification !== 'UNAVAILABLE' && batchAiResult.recommendedSymbols) {
        logger.info(`[NVIDIA AI Candidate Filter] GATE 80 policy prevents secondary analytics from rejecting a valid core signal. Applied soft-hurdle score penalty to non-recommended assets.`);
      }
    }

    const rsInputs = filteredCandidates.map((c) => ({
      symbol: c.signal.symbol, direction: c.signal.direction, candles: c.candles || [],
      currentPrice: c.signal.entryPrice, atr: c.scoring.technicalMetrics?.atr,
    }));
    const rsResults = Gate16RelativeStrength.rankCandidates(rsInputs);

    for (const cand of filteredCandidates) {
      const rs = rsResults.get(cand.signal.symbol);
      if (rs) {
        cand.signal.relativeStrengthScore = rs.relativeStrengthScore;
        cand.signal.relativeRank = rs.relativeRank;
        cand.signal.assetClassRank = rs.assetClassRank;
        cand.signal.marketContext = rs.marketContext;
        if (rs.reasons) cand.signal.confluenceReasons.push(...rs.reasons);
      }
    }

    const corrInputs = filteredCandidates.map((c) => ({
      symbol: c.signal.symbol, direction: c.signal.direction, candles: c.candles || [],
      score: c.signal.score, relativeStrengthScore: c.signal.relativeStrengthScore,
    }));
    const activeSignalsSimple = Array.from(engine.activeSignals.values()).map((s: any) => ({
      symbol: s.symbol, direction: s.direction, score: s.score,
    }));
    const corrResults = Gate17CorrelationExposure.evaluateCandidates(corrInputs, activeSignalsSimple);

    for (const cand of filteredCandidates) {
      const corr = corrResults.get(cand.signal.symbol);
      if (corr) {
        cand.signal.correlationScore = corr.correlationScore;
        cand.signal.correlationCluster = corr.correlationCluster;
        cand.signal.clusterExposure = corr.clusterExposure;
        cand.signal.correlationPenalty = corr.correlationPenalty;
        cand.signal.correlationLevel = corr.correlationLevel;
        if (corr.reasons) cand.signal.confluenceReasons.push(...corr.reasons);
      }
    }

    for (const cand of filteredCandidates) {
      const detectedRegime = (cand.scoring as any)?.regime || cand.signal.marketRegime || 'UNKNOWN';
      const regimeSelection = Gate18RegimeStrategySelection.selectStrategy({
        symbol: cand.signal.symbol, regime: detectedRegime, candidateStrategyName: cand.signal.strategy,
      });
      cand.signal.marketRegime = detectedRegime;
      cand.signal.selectedStrategy = regimeSelection.selectedStrategy;
      cand.signal.eligibleStrategies = regimeSelection.eligibleStrategies;
      cand.signal.strategyCompatibilityScore = regimeSelection.strategyCompatibilityScore;
      cand.signal.regimeStrategyMatch = regimeSelection.regimeStrategyMatch;
      if (regimeSelection.reasons) cand.signal.confluenceReasons.push(...regimeSelection.reasons);
    }

    for (const cand of filteredCandidates) {
      const calibration = Gate20ProbabilityCalibration.calibrateProbability({
        signalScore: cand.signal.score || 0, strategy: cand.signal.selectedStrategy || cand.signal.strategy,
        regime: cand.signal.marketRegime, assetClass: cand.signal.assetClass as any, timeframe: cand.signal.timeframe,
      });

      cand.signal.probabilityScoreBucket = calibration.scoreBucket;
      cand.signal.probabilitySampleSize = calibration.sampleSize;
      cand.signal.probabilityConfidenceInterval = calibration.confidenceInterval
        ? { lower: calibration.confidenceInterval.lowerPct, upper: calibration.confidenceInterval.upperPct } : null;
      cand.signal.calibrationStatus = calibration.calibrationStatus;

      if (thresholds.probabilitySource === 'EMPIRICAL' && calibration.sampleSize >= 30 && calibration.empiricalProbability !== null) {
        cand.signal.empiricalCalibratedProbability = calibration.empiricalProbability;
        cand.signal.empiricalProbability = calibration.empiricalProbability;
        cand.signal.isEmpiricallyCalibrated = true;
        cand.signal.estimatedWinRate = calibration.empiricalProbability;
      } else {
        cand.signal.estimatedWinRate = cand.signal.modelEstimatedWinRate || cand.signal.estimatedWinRate;
      }
      if (calibration.reasons) cand.signal.confluenceReasons.push(...calibration.reasons);
    }

    for (const cand of filteredCandidates) {
      try {
        const wfResult = Gate21WalkForwardValidation.validateStrategy(cand.signal.selectedStrategy || cand.signal.strategy);
        cand.signal.walkForwardEfficiency = wfResult.walkForwardEfficiency;
        cand.signal.walkForwardStatus = wfResult.status;
        cand.signal.overfitRiskDetected = wfResult.overfitRiskDetected;
        if (wfResult.reasons) cand.signal.confluenceReasons.push(...wfResult.reasons);
      } catch (err) {
        logger.warn(`[StagedScannerPipeline] Walk-forward validation failed for ${cand.signal.symbol}:`, { error: String(err) });
      }
    }

    for (const cand of filteredCandidates) {
      try {
        const mcResult = Gate22MonteCarloSimulation.runSimulation(cand.signal.selectedStrategy || cand.signal.strategy);
        cand.signal.monteCarloMedianMaxDrawdownR = mcResult.medianMaxDrawdownR;
        cand.signal.monteCarlo95PctDrawdownR = mcResult.percentile95MaxDrawdownR;
        cand.signal.monteCarloRiskOfRuinPct = mcResult.riskOfRuinPct;
        cand.signal.monteCarloSimulationStatus = mcResult.simulationStatus;
        if (mcResult.reasons) cand.signal.confluenceReasons.push(...mcResult.reasons);
      } catch (err) {
        logger.warn(`[StagedScannerPipeline] Monte Carlo simulation failed for ${cand.signal.symbol}:`, { error: String(err) });
      }
    }

    const finalValidationOutputCount = filteredCandidates.length;
    logger.info(`[Final validation] Input: ${deepMtfOutputCount} assets, Output: ${finalValidationOutputCount} validated candidates`);

    // -----------------------------------------------------------------
    // GATE 9 — FINAL SIGNAL CAP (Max 3 tradeable signals)
    // Rank by final score -> Select top 3. If zero reach signalThreshold -> zero signals.
    // -----------------------------------------------------------------
    const gate9Input = filteredCandidates.map((c) => ({
      signal: c.signal,
      finalScore: c.signal.score || thresholds.signalThreshold,
      data: c,
    }));
    const gate9CapResult = Gate9FinalSignalCap.applySignalCap(gate9Input);
    const finalSignals = gate9CapResult.publishedSignals;
    const finalSignalsOutputCount = finalSignals.length;

    for (const rej of (gate9CapResult.spilloverCandidates || [])) {
      rejectionTracker.recordCandidate({
        symbol: rej.signal.symbol,
        direction: rej.signal.direction,
        score: rej.finalScore,
        primaryRejectionReason: `Gate 9 Cap: Exceeded max allowed signals in scan`,
        failedGates: [StandardFailedGate.SIGNAL_CAP_EXCEEDED],
        finalDecision: 'REJECTED',
        stage: 'GATE_9',
        entryPrice: rej.signal.entryPrice,
        stopLoss: rej.signal.stopLoss,
        takeProfit: rej.signal.takeProfit,
        tp1: rej.signal.tp1,
        tp2: rej.signal.tp2,
        tp3: rej.signal.tp3,
        timestamp: now,
        factors: rej.signal.factors,
      });
    }

    for (const sig of finalSignals) {
      rejectionTracker.recordCandidate({
        symbol: sig.symbol,
        direction: sig.direction,
        score: sig.score || thresholds.signalThreshold,
        primaryRejectionReason: 'All mandatory gates passed and qualified for dispatch',
        failedGates: [],
        finalDecision: 'DISPATCHED',
        stage: 'FINAL_DISPATCH',
        factors: sig.factors,
      });
    }

    rejectionTracker.logScanSummary(assetCategory || cleanSymbol);

    // -----------------------------------------------------------------
    // GATE 10 — RATE-LIMIT SAFETY + SCANNER TELEMETRY
    // -----------------------------------------------------------------
    const currentElapsedMs = Date.now() - globalScanStartMs;
    const remainingBudgetMs = Math.max(0, globalScanDeadlineMs - Date.now());
    const scanDuration = currentElapsedMs;
    if (remainingBudgetMs <= 0) {
      timeBudgetExceeded = true;
    }
    const cacheStats = marketCache.getStats();
    const assetsCached = marketCache.getCachedSymbolsCount(universe);
    const providerRequests = quotaManager.getTotalSessionRequestsAll() - initialSessionRequests;
    const providerErrors = quotaManager.getTotalRecentErrors() - initialErrors;
    const providerTimeouts = quotaManager.getTotalRecentTimeouts() - initialTimeouts;

    const categorizedCounts = rejectionTracker.getCategorizedRejectionCounts();

    const gate10Data: Gate10ScanTelemetryData = {
      scanId: `scan_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      assetCategory,
      assetsReceived: universe.length,
      assetsCached,
      cacheHits: cacheStats.hits,
      cacheMisses: cacheStats.misses,
      preliminaryCandidates: stage1OutputCount,
      quotaRemainingBeforeDeepScan: quotaManager.getOverallUsableQuota(),
      deepCandidatesAllowed: gate4Budget.maxDeepCandidates,
      deepCandidatesEvaluated: gate5OutputCount,
      mtfLayer1Evaluated: gate6Inputs.length,
      mtfLayer2Evaluated: gate6Analysis.survivedCandidates.length,
      executionChecks: deepMtfOutputCount,
      hardGateFailures: gate7FailuresCount,
      finalScores: allCandidateScores,
      signalsGenerated: finalSignals.length,
      providerRequests: Math.max(0, providerRequests),
      providerErrors: Math.max(0, providerErrors),
      providerTimeouts: Math.max(0, providerTimeouts),
      scanDuration,
      globalScanStartMs,
      globalScanDeadlineMs,
      currentElapsedMs,
      remainingBudgetMs,
      gate6ElapsedMs,
      stage3ElapsedMs,
      timeBudgetExceeded,
      providerRequestsStoppedByBudget,
      candidatesRejectedBeforeMTF: categorizedCounts.candidatesRejectedBeforeMTF,
      candidatesRejectedByMTF: categorizedCounts.candidatesRejectedByMTF,
      candidatesRejectedByScore: categorizedCounts.candidatesRejectedByScore,
      candidatesRejectedByRR: categorizedCounts.candidatesRejectedByRR,
      candidatesRejectedByStructure: categorizedCounts.candidatesRejectedByStructure,
      stageBreakdown: {
        stage0Screening: { input: universe.length, output: stage0OutputCount },
        stage1Preliminary: { input: stage0OutputCount, output: stage1OutputCount },
        gate4Budget: { health: gate4Budget.overallBudgetHealth, maxAllowed: gate4Budget.maxDeepCandidates },
        gate5Selection: { input: stage1OutputCount, output: gate5OutputCount },
        gate6Layer1Mtf: { input: gate6Inputs.length, output: gate6Analysis.survivedCandidates.length },
        gate6Layer2Mtf: { input: gate6Analysis.survivedCandidates.length, output: deepMtfOutputCount },
        gate7HardGates: { input: deepMtfOutputCount, output: finalValidationOutputCount, failures: gate7FailuresCount },
        gate8ScoreThreshold: { input: finalValidationOutputCount, output: allCandidateScores.filter((s) => s.passed).length, threshold: thresholds.signalThreshold },
        gate9SignalCap: { input: allCandidateScores.filter((s) => s.passed).length, output: finalSignals.length, cap: 3 },
      },
    };

    Gate10ScannerTelemetry.recordScan(gate10Data);

    const rejStage0 = universe.length - stage0OutputCount;
    const rejStage1 = stage0OutputCount - stage1OutputCount;
    const rejGate5 = gate5Selection.rejectedCandidates.length;
    const rejGate6L1 = gate6Analysis.rejectedCandidates.filter((r) => r.stoppedAtLayer === 1).length;
    const rejGate6L2 = gate6Analysis.rejectedCandidates.filter((r) => r.stoppedAtLayer === 2).length;
    const rejStage2 = deepMtfOutputCount - finalValidationOutputCount;
    const rejGate7 = gate7FailuresCount;
    const rejGate8 = allCandidateScores.filter((s) => !s.passed).length;
    const rejGate9 = Math.max(0, allCandidateScores.filter((s) => s.passed).length - finalSignalsOutputCount);

    logger.info(`================================================================`);
    logger.info(`[CANDIDATE FUNNEL AUDIT] Category: ${assetCategory}`);
    logger.info(`- preliminaryCandidates: ${stage1OutputCount}`);
    logger.info(`- candidatesAfterQuota: ${gate4Budget.maxDeepCandidates} (Health: ${gate4Budget.overallBudgetHealth})`);
    logger.info(`- candidatesAfterRanking: ${gate5Selection.candidatesAfterRankingCount}`);
    logger.info(`- candidatesAfterCorrelation: ${gate5Selection.candidatesAfterCorrelationCount}`);
    logger.info(`- candidatesSelectedForDeepAnalysis: ${gate5OutputCount}`);
    logger.info(`- candidatesRejectedAtEachStage:`);
    logger.info(`  * Stage 0 (Session Closed / Invalid): ${rejStage0}`);
    logger.info(`  * Stage 1 Preliminary (<60 score): ${rejStage1}`);
    logger.info(`  * Gate 5 Deep Selection (Rank / Cluster Cap): ${rejGate5}`);
    logger.info(`  * Gate 6 Layer 1 MTF (15m/1h Disagreement): ${rejGate6L1}`);
    logger.info(`  * Gate 6 Layer 2 MTF (5m/4h Structure / ATR): ${rejGate6L2}`);
    logger.info(`  * Stage 2 Scoring (<${thresholds.signalThreshold} Score or Setup Mismatch): ${rejStage2}`);
    logger.info(`  * Stage 3 Gate 7 (13 Mandatory Hard Gates): ${rejGate7}`);
    logger.info(`  * Gate 8 Final Score Threshold (<${thresholds.signalThreshold}): ${rejGate8}`);
    logger.info(`  * Gate 9 Signal Cap (Excess over max 3): ${rejGate9}`);
    logger.info(`================================================================`);

    logger.info(`[STAGED PIPELINE REPORT]`);
    logger.info(`- Stage 0 (Session Screening): Input ${universe.length}, Output ${stage0OutputCount}`);
    logger.info(`- Stage 1 (Cheap Preliminary Screen): Input ${stage0OutputCount}, Output ${stage1OutputCount}`);
    logger.info(`- Gate 4 (Provider Quota Gate): Health ${gate4Budget.overallBudgetHealth}, Max Deep Allowed: ${gate4Budget.maxDeepCandidates}`);
    logger.info(`- Gate 5 (Deep Candidate Selection): Input ${stage1OutputCount}, Output ${gate5OutputCount}`);
    logger.info(`- Gate 6 (Progressive Deep MTF): Layer 1 Evaluated: ${gate6Inputs.length}, Layer 2 Evaluated: ${gate6Analysis.survivedCandidates.length}, Output ${deepMtfOutputCount}`);
    logger.info(`- Gate 7 (Final Trade Hard Gates): Input ${deepMtfOutputCount}, Failures: ${gate7FailuresCount}, Output ${finalValidationOutputCount}`);
    logger.info(`- Gate 8 (Tradeability Threshold >=${thresholds.signalThreshold}): Input ${finalValidationOutputCount}, Scored >=${thresholds.signalThreshold}: ${allCandidateScores.filter(s => s.passed).length}`);
    logger.info(`- Gate 9 (Signal Cap <=3): Published ${finalSignalsOutputCount} Signals`);

    const aggregatedReasons = rejectionTracker.getAggregatedRejectionReasons();
    const candidateAuditRecords = rejectionTracker.getAllRecords();

    profiler.endStage('Stage 3: Final Trade Validation', finalSignals.length);

    const candidatesThresholdPlusCount = allCandidateScores.filter((s) => s.score >= thresholds.signalThreshold).length + gate6Analysis.rejectedCandidates.filter((r) => (r.finalScore >= thresholds.signalThreshold || r.compositeMtfScore >= thresholds.signalThreshold)).length;
    const rejectedThresholdPlusCount = allCandidateScores.filter((s) => s.score >= thresholds.signalThreshold && !s.passed).length + gate6Analysis.rejectedCandidates.filter((r) => (r.finalScore >= thresholds.signalThreshold || r.compositeMtfScore >= thresholds.signalThreshold)).length;

    profiler.setFunnelMetrics({
      preliminaryCandidates: stage1OutputCount,
      deepCandidates: gate5OutputCount,
      MTFCandidates: deepMtfOutputCount,
      candidates72Plus: candidatesThresholdPlusCount,
      rejected72PlusCandidates: rejectedThresholdPlusCount,
      signalsGenerated: finalSignals.length,
      signalsAccepted: finalSignals.length,
    });
    const totalBudgetStopped = providerRequestsStoppedByBudget || (profiler.getStoppedByBudgetCount() > 0);
    profiler.setStoppedByBudget(totalBudgetStopped);
    profiler.setRejectionReasons(aggregatedReasons);

    profiler.endScan();
    setActiveProfiler(null);

    const stageTelemetry = {
      stage0Input: universe.length, stage0Output: stage0OutputCount,
      stage1Input: stage0OutputCount, stage1Output: stage1OutputCount,
      gate4BudgetHealth: gate4Budget.overallBudgetHealth,
      gate4MaxDeepAllowed: gate4Budget.maxDeepCandidates,
      gate5Input: stage1OutputCount, gate5Output: gate5OutputCount,
      deepMtfInput: gate5OutputCount, deepMtfOutput: deepMtfOutputCount,
      finalValidationInput: deepMtfOutputCount, finalValidationOutput: finalValidationOutputCount,
      finalScoreGateInput: finalValidationOutputCount, finalScoreGateOutput: finalSignalsOutputCount,
      globalScanStartMs,
      globalScanDeadlineMs,
      globalScanSoftDeadlineMs,
      currentElapsedMs,
      remainingBudgetMs,
      gate6ElapsedMs,
      stage3ElapsedMs,
      timeBudgetExceeded,
      providerRequestsStoppedByBudget: totalBudgetStopped,
      executionId,
      scanId: executionId,
      gate10Telemetry: gate10Data,
      rejectionReasons: aggregatedReasons,
      candidateRejectionDetails: candidateAuditRecords,
    };

    if (finalSignals.length > 0) {
      for (const sig of finalSignals) {
        if (process.env.NODE_ENV === 'production' && !ScannerPersistence.isProductionPersistenceReady()) {
          sig.isTradeableSignal = false;
          sig.signalClassification = 'DIAGNOSTIC';
          continue;
        }

        if (persistAndActivate) {
          const inc = await ScannerPersistence.tryIncrementCap(thresholds.dailySignalCap || 10);
          if (!inc.allowed) break;

          sig.isTradeableSignal = true;
          sig.signalClassification = 'TRADEABLE';

          const persRes = await ScannerPersistence.recordSentSignal(sig);
          const logRes = await SignalLogger.logSignal(sig, sig.marketRegime || 'TREND');

          if (!persRes.success || !logRes.success || logRes.status !== 'TRADEABLE_RECORD_PERSISTED') {
            await ScannerPersistence.releaseCap(inc.reservationId);
            sig.isTradeableSignal = false;
            sig.signalClassification = 'DIAGNOSTIC';
            continue;
          }

          await ScannerPersistence.commitCap(inc.reservationId);
          engine.activeSignals.set(sig.symbol, sig);

          SignalFingerprint.recordFingerprint({
            symbol: sig.symbol, direction: sig.direction, entryPrice: sig.entryPrice,
            timeframe: sig.timeframe, primaryStrategy: sig.strategy,
          });

          CooldownManager.recordSignalEmit(sig.symbol, sig.strategy, sig.timestamp);
        }

        const sigFp = SignalFingerprint.generateFingerprint({
          symbol: sig.symbol,
          direction: sig.direction,
          entryPrice: sig.entryPrice,
          timeframe: sig.timeframe,
          primaryStrategy: sig.strategy,
        });

        SignalAuditStore.logAudit({
          symbol: sig.symbol, direction: sig.direction, timeframe: sig.timeframe,
          primaryStrategy: sig.strategy, strategy: sig.strategy, passedStrategies: [sig.strategy],
          failedStrategies: [], marketRegime: sig.marketRegime || 'UNKNOWN', regime: sig.marketRegime || 'UNKNOWN',
          threshold: sig.score, actualScore: sig.score, marginAboveThreshold: 0, atr: 0, dataFreshnessSeconds: 0,
          providerAgreement: true, expectedRR: sig.riskRewardRatio, score: sig.score, status: 'ACCEPTED',
          rejectionReason: null, fingerprint: sigFp,
        });
      }

      const bestTrade = finalSignals[0];
      const secondBest = finalSignals.length > 1 ? finalSignals[1] : undefined;
      const suggestions = finalSignals.length > 2 ? finalSignals.slice(2) : [];
      const primarySignal = bestTrade;

      return {
        success: true,
        message: `Multi-Asset Scan completed. BEST: ${bestTrade?.symbol || 'N/A'}${secondBest ? ', SECOND: ' + secondBest.symbol : ''}.`,
        symbol: primarySignal.symbol,
        marketPrice: primarySignal.entryPrice,
        signal: primarySignal,
        signals: finalSignals,
        bestTrade, secondBest, suggestions,
        timestamp: now,
        rejectionReasons: aggregatedReasons,
        candidateRejectionDetails: candidateAuditRecords,
        telemetry: {
          universeSymbolsScanned: universe.length,
          preliminaryCandidatesFound: stage1OutputCount,
          candidatesRejectedPreliminary: universe.length - stage1OutputCount,
          candidatesEvaluated: gate5OutputCount,
          candidatesRejectedFinal: gate5OutputCount - finalSignals.length,
          signalsGenerated: finalSignals.length,
          signalsAccepted: finalSignals.length,
          ...stageTelemetry,
        },
      };
    }

    return {
      success: false,
      message: 'NO QUALIFIED TRADE',
      symbol: cleanSymbol,
      reason: `Scan completed: No setups satisfied final validation or score hurdles.`,
      timestamp: now,
      rejectionReasons: aggregatedReasons,
      candidateRejectionDetails: candidateAuditRecords,
      telemetry: {
        universeSymbolsScanned: universe.length,
        preliminaryCandidatesFound: stage1OutputCount,
        candidatesRejectedPreliminary: universe.length - stage1OutputCount,
        candidatesEvaluated: gate5OutputCount,
        candidatesRejectedFinal: gate5OutputCount,
        signalsGenerated: 0,
        signalsAccepted: 0,
        ...stageTelemetry,
      },
    };

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('Multi-Asset scan failed with exception', { symbol: cleanSymbol, error: errMsg });

    profiler.recordError(errMsg);
    profiler.endScan();
    setActiveProfiler(null);

    return {
      success: false,
      message: 'NO QUALIFIED TRADE',
      symbol: cleanSymbol,
      reason: `Multi-asset scanning interrupted: ${errMsg}`,
      timestamp: now,
      telemetry: getEmptyTelemetry(universe.length, 0, 0, getTimingSnapshot()),
    };
  }
}
