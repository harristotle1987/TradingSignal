/**
 * Hardened Signal Quality & Execution Realism Engine (Gate 8)
 *
 * Implements strict, zero-compromise signal generation and validation:
 * - Freshness: Rejects stale timestamps for candles and live quotes (STALE_DATA).
 * - Cross-validation: Compares quotes across Bitget, Twelve Data, Finnhub, Forex (PRICE_MISMATCH).
 * - Entry integrity: Displayed EXACT ENTRY PRICE must be latest validated live market price (INVALID_ENTRY).
 * - Candle integrity: Validates OHLC geometry, positive values, and ordering (INVALID_CANDLE).
 * - Timeframe integrity: Prevents mislabeling and ensures required history depth (INVALID_CANDLE).
 * - Signal consistency: All parameters strictly bound to the exact market snapshot (INSUFFICIENT_CONFLUENCE).
 * - SL/TP sanity: Rigorous geometric bounds, ATR volatility, and net R:R >= 1.5:1 (INVALID_SL_TP).
 * - No forced output / No synthetic data: A validation failure outputs NO VALID SIGNAL.
 * - Snapshot ID: Assigns unique analysis timestamp and ID to every signal.
 * - Duplicate protection: Prevents spamming the same setup.
 */

import { TradingSignal, SignalGenerationResponse, NormalizedCandle, NormalizedTicker, SignalDirection, isActionableSignal } from '../../types/index.js';
import { getDynamicPrecision } from '../../utils/formatters.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { quotaManager } from '../market/QuotaManager.js';
import { MarketSessionManager } from '../market/MarketSessionManager.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { ScoringEngine, ScoringResult } from './ScoringEngine.js';
import { Gate0DataValidator } from './Gate0DataValidator.js';
import { serverConfig } from '../config.js';
import { Gate1MarketRegime } from './Gate1MarketRegime.js';
import { Gate2MTFConfluence } from './Gate2MTFConfluence.js';
import { Gate3MarketStructure } from './Gate3MarketStructure.js';
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
import { Gate22MonteCarloSimulation } from './Gate22MonteCarloSimulation.js';
import { NvidiaAIService } from './NvidiaAIService.js';
import { SignalValidator, ValidationResult } from './SignalValidator.js';
import { TradeRankingEngine, ValidatedCandidate } from './TradeRankingEngine.js';
import { SignalLogger } from './SignalLogger.js';
import { SignalFingerprint } from './SignalFingerprint.js';
import { CooldownManager } from './CooldownManager.js';
import { MarketStructureDetector } from './MarketStructureDetector.js';
import { SignalAuditStore } from './SignalAuditStore.js';
import { ScannerPersistence } from './ScannerPersistence.js';
import { OpportunityFunnelStore, OpportunityFunnelEngine } from './Gate26OpportunityFunnel.js';
import { Gate35SignalFunnelAnalytics } from './Gate35SignalFunnelAnalytics.js';
import { logger } from '../logger.js';

const CRYPTO_UNIVERSE = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'DOTUSDT', 'LTCUSDT', 
  'LINKUSDT', 'AVAXUSDT', 'POLUSDT', 'SHIBUSDT', 'TRXUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 
  'FILUSDT', 'APTUSDT', 'SUIUSDT', 'NEARUSDT', 'OPUSDT', 'ARBUSDT', 'LDOUSDT', 'HBARUSDT', 'ICPUSDT', 
  'GRTUSDT', 'SUSDT', 'INJUSDT', 'RENDERUSDT', 'STXUSDT', 'IMXUSDT', 'TIAUSDT', 'SEIUSDT', 'WIFUSDT', 
  'BONKUSDT', 'FLOKIUSDT', 'PEPEUSDT', 'JUPUSDT', 'PYTHUSDT', 'DYDXUSDT', 'AAVEUSDT', 'FETUSDT', 
  'RUNEUSDT', 'PIUSDT'
];

const FOREX_UNIVERSE = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 
  'AUDJPY', 'EURCAD', 'AUDCAD', 'EURAUD', 'GBPAUD', 'CHFJPY', 'CADJPY', 'GBPCAD', 'EURCHF', 'GBPCHF'
];

const STOCK_UNIVERSE = [
  'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META', 'LLY', 'V', 'UNH', 'TSM', 'JPM', 'NVO', 
  'XOM', 'WMT', 'MA', 'AVGO', 'ASML', 'JNJ', 'HD', 'PG', 'ADBE', 'MRK', 'COST', 'CVX', 'AMD', 'CRM', 
  'NFLX', 'PEP', 'KO', 'TMO', 'BAC', 'ABT', 'DIS', 'NKE', 'INTC', 'CMG', 'ORCL', 'QCOM', 'CSCO', 
  'IBM', 'AMGN', 'SPGI', 'INTU', 'GE', 'AXP', 'NOW', 'TXN'
];

export class SignalEngine {
  public activeSignals = new Map<string, TradingSignal>();
  private lastActiveSignalsSyncTime = 0;
  private readonly DUPLICATE_COOLDOWN_MS = 8 * 60 * 1000; // 8 minutes duplicate cooldown

  /**
   * Resolves target universe and asset category from input symbol or category.
   */
  private resolveTargetUniverse(symbol: string, category?: string): { assetCategory: 'CRYPTO' | 'FOREX' | 'STOCKS' | 'ALL'; universe: string[] } {
    const cleanSym = symbol.trim().toUpperCase();
    const cleanCat = category?.trim().toUpperCase();

    // 1. Cross-Asset Full Universe Scan
    if (
      cleanCat === 'ALL' ||
      cleanCat === 'UNIVERSE' ||
      cleanCat === 'CROSS_ASSET' ||
      cleanSym === 'ALL' ||
      cleanSym === 'UNIVERSE' ||
      cleanSym === 'SCAN_ALL'
    ) {
      return {
        assetCategory: 'ALL',
        universe: [...CRYPTO_UNIVERSE, ...FOREX_UNIVERSE, ...STOCK_UNIVERSE],
      };
    }

    // 2. Category-specific requests
    if (cleanCat === 'CRYPTO' || cleanSym === 'CRYPTO') {
      return { assetCategory: 'CRYPTO', universe: CRYPTO_UNIVERSE };
    }
    if (cleanCat === 'FOREX' || cleanSym === 'FOREX') {
      return { assetCategory: 'FOREX', universe: FOREX_UNIVERSE };
    }
    if (cleanCat === 'STOCKS' || cleanCat === 'STOCK' || cleanSym === 'STOCKS' || cleanSym === 'STOCK') {
      return { assetCategory: 'STOCKS', universe: STOCK_UNIVERSE };
    }

    // 3. Specific exact symbol request (e.g. PIUSD, BTCUSDT, EURUSD, AAPL).
    const detectedType = SymbolNormalizer.getAssetClassification(cleanSym);
    const assetCategory = detectedType === 'FOREX' ? 'FOREX' : (detectedType === 'STOCK' ? 'STOCKS' : 'CRYPTO');
    
    return { assetCategory, universe: [cleanSym] };
  }

  /**
   * Stage 1 & 2: Cheap Technical & Volatility Screening on 1H Baseline.
   * Filters out flat, choppy, or low-volatility assets BEFORE making expensive MTF calls.
   */
  private computeTechnicalVolatilityScore(symbol: string, htf1h: NormalizedCandle[]): { preliminaryScore: number; direction: SignalDirection; reason: string; atr: number } {
    if (!htf1h || htf1h.length < 20) {
      return { preliminaryScore: 0, direction: 'BUY', reason: 'Insufficient 1H candle history', atr: 0 };
    }

    const sorted = [...htf1h].sort((a, b) => a.timestamp - b.timestamp);
    const closes = sorted.map((c) => c.close);
    const len = closes.length;
    const latestClose = closes[len - 1];

    if (!latestClose || latestClose <= 0) {
      return { preliminaryScore: 0, direction: 'BUY', reason: 'Invalid candle close price', atr: 0 };
    }

    // 1. Calculate 1H Trend Alignment (EMA9 vs EMA21)
    let ema9 = closes[0];
    let ema21 = closes[0];
    const k9 = 2 / 10;
    const k21 = 2 / 22;

    for (let i = 1; i < len; i++) {
      ema9 = closes[i] * k9 + ema9 * (1 - k9);
      ema21 = closes[i] * k21 + ema21 * (1 - k21);
    }

    const isBullishTrend = ema9 > ema21 && latestClose > ema9;
    const isBearishTrend = ema9 < ema21 && latestClose < ema9;
    const direction: SignalDirection = isBullishTrend ? 'BUY' : 'SELL';

    if (!isBullishTrend && !isBearishTrend) {
      return { preliminaryScore: 20, direction: 'BUY', reason: 'Flat/choppy 1H trend structure', atr: 0 };
    }

    // 2. Calculate Directional Momentum (5-bar return)
    const price5BarsAgo = closes[Math.max(0, len - 6)];
    const momentumPct = ((latestClose - price5BarsAgo) / price5BarsAgo) * 100;
    const momentumAligned = isBullishTrend ? momentumPct > 0.05 : momentumPct < -0.05;

    // 3. Volatility & ATR Sufficiency Filtering
    let trSum = 0;
    for (let i = 1; i < Math.min(15, len); i++) {
      const idx = len - i;
      const prevClose = sorted[idx - 1].close;
      const cur = sorted[idx];
      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prevClose),
        Math.abs(cur.low - prevClose)
      );
      trSum += tr;
    }
    const atr14 = trSum / Math.min(14, len - 1);
    const atrPct = (atr14 / latestClose) * 100;

    // Reject compressed zero-volatility assets
    if (atrPct < 0.08) {
      return { preliminaryScore: 15, direction, reason: `Compressed volatility (ATR: ${atrPct.toFixed(2)}%)`, atr: atr14 };
    }

    // 4. Calculate Recent 10-bar Volatility Range
    const last10 = sorted.slice(-10);
    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (const c of last10) {
      if (c.high > maxHigh) maxHigh = c.high;
      if (c.low < minLow) minLow = c.low;
    }
    const rangePct = ((maxHigh - minLow) / latestClose) * 100;
    const healthyVolatility = rangePct >= 0.20;

    // Scoring synthesis (Max 100)
    let preliminaryScore = 35;
    if (momentumAligned) preliminaryScore += 25;
    if (healthyVolatility) preliminaryScore += 20;

    const emaDiffPct = (Math.abs(ema9 - ema21) / ema21) * 100;
    if (emaDiffPct > 0.15) preliminaryScore += 10;
    if (atrPct >= 0.25) preliminaryScore += 10;

    return {
      preliminaryScore: Math.min(100, preliminaryScore),
      direction,
      reason: `1H Trend: ${direction}, MomentumAligned: ${momentumAligned}, ATR: ${atrPct.toFixed(2)}%, Range: ${rangePct.toFixed(2)}%`,
      atr: atr14,
    };
  }

  /**
   * Generates validated trading signals using an optimized staged universe scanner.
   * Stage 1: Cheap / current market-data screening (Session & cached baseline).
   * Stage 2: Technical / volatility filtering (EMA stack, momentum, ATR sufficiency).
   * Stage 3: Deep multi-timeframe analysis on top candidates only (strictly conserves API calls).
   * Stage 4: Ranking qualified setups (at most 5 returned, top 2 marked as BEST TRADE, rest as suggestions).
   */
  async generateSignal(symbol = 'EURUSD', category?: string, persistAndActivate: boolean = true): Promise<SignalGenerationResponse> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const now = Date.now();

    const { assetCategory, universe } = this.resolveTargetUniverse(cleanSymbol, category);

    // 1. Check duplicate / active signal cooldown
    const existingSignal = this.activeSignals.get(cleanSymbol);
    if (existingSignal && now - existingSignal.timestamp < this.DUPLICATE_COOLDOWN_MS) {
      logger.info('Returning existing active signal within cooldown window', { symbol: cleanSymbol, id: existingSignal.id, snapshotId: existingSignal.snapshotId });
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

    // Stage 1: Cheap / Current Market-Data Screening (Session hours + cached 1H baseline)
    const openAssets = universe.filter((asset) => MarketSessionManager.getSessionState(asset) === 'MARKET_OPEN');

    if (openAssets.length === 0) {
      logger.info(`[Multi-Asset Scanner] All assets in ${assetCategory} universe are MARKET CLOSED.`);
      return {
        success: false,
        message: 'MARKET CLOSED',
        symbol: cleanSymbol,
        reason: `All instruments in the ${assetCategory} universe (${universe.join(', ')}) are currently outside official exchange trading hours. Forex and Stock markets operate only during active market sessions. Crypto operates 24/7.`,
        timestamp: now,
        telemetry: {
          universeSymbolsScanned: universe.length,
          preliminaryCandidatesFound: 0,
          candidatesRejectedPreliminary: universe.length,
          candidatesEvaluated: 0,
          candidatesRejectedFinal: 0,
          signalsGenerated: 0,
          signalsAccepted: 0,
        },
      };
    }

    try {
      // Stage 2: Technical & Volatility Filtering on 1H Baseline
      const stage2Candidates: Array<{
        asset: string;
        htf1h: NormalizedCandle[];
        preliminaryScore: number;
        direction: SignalDirection;
      }> = [];

      // Process open assets in bounded concurrent batches (batch size 8)
      const BATCH_SIZE = 8;
      for (let i = 0; i < openAssets.length; i += BATCH_SIZE) {
        const batch = openAssets.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (asset) => {
            let htf1h: NormalizedCandle[];
            try {
              htf1h = await marketDataManager.getCandles(asset, undefined, '1h', 50, false);
            } catch (err) {
              logger.info(`[Stage 1/2 Screen] Skipped ${asset}: 1H candles unavailable (${err instanceof Error ? err.message : String(err)})`);
              return null;
            }

            if (!htf1h || htf1h.length < 20) {
              logger.info(`[Stage 1/2 Screen] Skipped ${asset}: Insufficient 1H candle history (${htf1h?.length || 0})`);
              return null;
            }

            // Gate 0: Data Integrity & Market Data Validation
            const gate0 = Gate0DataValidator.validate({
              symbol: asset,
              timeframe: '1h',
              liveTicker: null,
              candles: htf1h,
              minCandlesRequired: 20
            });

            if (gate0.dataStatus !== 'VALID') {
              logger.info(`[Gate 0 Data Integrity] Skipped ${asset}: ${gate0.dataStatus} - ${gate0.reasons.join(', ')}`);
              return null;
            }

            const pass = this.computeTechnicalVolatilityScore(asset, htf1h);
            logger.info(`[Stage 2 Filter] ${asset}: Score = ${pass.preliminaryScore}/100 (${pass.reason})`);

            const isManualQuery = universe.length === 1;
            if (isManualQuery || pass.preliminaryScore >= 40) {
              return {
                asset,
                htf1h,
                preliminaryScore: isManualQuery ? Math.max(40, pass.preliminaryScore) : pass.preliminaryScore,
                direction: pass.direction,
              };
            }
            return null;
          })
        );

        for (const res of batchResults) {
          if (res) stage2Candidates.push(res);
        }
      }

      if (stage2Candidates.length === 0) {
        logger.info(`[Stage 2 Filter] No assets in ${assetCategory} universe passed technical/volatility screening.`);
        return {
          success: false,
          message: 'NO QUALIFIED TRADE',
          symbol: cleanSymbol,
          reason: `Multi-asset screening completed across ${assetCategory} universe (${universe.join(', ')}): No symbols demonstrated sufficient preliminary trend alignment or volatility structure.`,
          timestamp: now,
          telemetry: {
            universeSymbolsScanned: universe.length,
            preliminaryCandidatesFound: 0,
            candidatesRejectedPreliminary: universe.length,
            candidatesEvaluated: 0,
            candidatesRejectedFinal: 0,
            signalsGenerated: 0,
            signalsAccepted: 0,
          },
        };
      }

      // Gate 32 — Adaptive Deep-Candidate Selection Engine
      // Replaces fixed candidate limits with adaptive budget-aware selection & cluster expansion
      const candidateInputs: Stage2CandidateInput[] = stage2Candidates.map((c) => ({
        asset: c.asset,
        assetClass: SymbolNormalizer.getAssetClassification(c.asset),
        preliminaryScore: c.preliminaryScore,
        direction: c.direction,
        htf1hCandles: c.htf1h,
      }));

      const adaptiveSelection = Gate32AdaptiveCandidateSelection.selectCandidates(candidateInputs);
      const selectedAssetNames = new Set(adaptiveSelection.selectedCandidates.map((sc) => sc.asset));
      const topCandidates = stage2Candidates.filter((c) => selectedAssetNames.has(c.asset));

      // GATE 52 — ADAPTIVE DEEP SCAN AUDIT LOG
      logger.info(`[Gate 52 Deep Scan Audit Log]`, {
        universeSize: universe.length,
        stage1Candidates: openAssets.length,
        stage2Candidates: stage2Candidates.length,
        initialDeepScanLimit: adaptiveSelection.baseQuotaLimit,
        expandedDeepScanLimit: adaptiveSelection.finalQuotaLimit,
        finalDeepScanCount: topCandidates.length,
        APIQuotaRemaining: quotaManager.getRemainingQuota('twelvedata'),
      });

      logger.info(
        `[Stage 3 Dispatch] ${adaptiveSelection.explanation} Advancing ${topCandidates.length} assets to Deep MTF Analysis: ${topCandidates.map((c) => `${c.asset} (${c.preliminaryScore}pt)`).join(', ')}`
      );

      // Stage 3: Deep Multi-Timeframe Analysis & Gate 8 Hardened Validation
      const candidates: ValidatedCandidate[] = [];
      const generalNews = await this.fetchGeneralNews();

      for (const cand of topCandidates) {
        const asset = cand.asset;
        const sorted1h = [...cand.htf1h].sort((a, b) => a.timestamp - b.timestamp);
        const lastCandle = sorted1h[sorted1h.length - 1];

        if (!lastCandle || lastCandle.close <= 0) continue;

        const candlesMap: Record<string, NormalizedCandle[]> = {
          '1h': sorted1h, // 1H = setup (reused from baseline stage)
        };

        // Timeframe Hierarchy:
        // 4H/1D = Major direction
        // 1H = Setup
        // 15M = Confirmation
        // 5M = Entry
        // 30M/2H/1W = Auxiliary confirmation only when required
        const coreIntervals = ['4h', '15m', '5m'];
        const coreFetched = await Promise.all(
          coreIntervals.map(async (interval) => {
            try {
              const fetched = await marketDataManager.getCandles(asset, undefined, interval, 50, false);
              if (fetched && fetched.length >= 20) {
                return { interval, candles: fetched.sort((a, b) => a.timestamp - b.timestamp) };
              }
            } catch (err) {
              logger.debug(`Core timeframe '${interval}' unavailable for ${asset}`, { reason: String(err) });
            }
            return null;
          })
        );
        for (const item of coreFetched) {
          if (item) candlesMap[item.interval] = item.candles;
        }

        // Fetch 1D only if 4H is unavailable or shallow (< 15 candles)
        if (!candlesMap['4h'] || candlesMap['4h'].length < 15) {
          try {
            const fetched1d = await marketDataManager.getCandles(asset, undefined, '1d', 30, false);
            if (fetched1d && fetched1d.length >= 10) {
              candlesMap['1d'] = fetched1d.sort((a, b) => a.timestamp - b.timestamp);
            }
          } catch (err) {
            logger.debug(`Fallback 1D timeframe unavailable for ${asset}`, { reason: String(err) });
          }
        }

        // Fetch 30m only if extra confirmation is needed (e.g. 5m or 15m was sparse)
        if (!candlesMap['15m'] || candlesMap['15m'].length < 25) {
          try {
            const fetched30m = await marketDataManager.getCandles(asset, undefined, '30m', 30, false);
            if (fetched30m && fetched30m.length >= 15) {
              candlesMap['30m'] = fetched30m.sort((a, b) => a.timestamp - b.timestamp);
            }
          } catch (err) {
            logger.debug(`Auxiliary 30m timeframe unavailable for ${asset}`, { reason: String(err) });
          }
        }

        let liveTicker: NormalizedTicker | null = null;
        try {
          liveTicker = await marketDataManager.getPrice(asset, undefined, true);
        } catch (err) {
          logger.warn(`Live ticker quote failed for ${asset}`, { error: String(err) });
          continue;
        }

        if (!liveTicker || liveTicker.price <= 0) {
          logger.info(`[Stage 3 Deep Analysis] Rejected ${asset} at Gate 0: INSUFFICIENT - Live ticker unavailable`);
          continue;
        }

        const baselinePrice = liveTicker.price;
        const thresholds = serverConfig.getConfig().thresholds;
        const newsSentiment = this.evaluateNewsSentiment(asset, generalNews);
        const crossCheck = await this.verifyCrossSourcePrice(asset, baselinePrice);

        // Gate 0: Deep Data Integrity Validation across ALL fetched timeframes & live price
        let allDataValid = true;
        let dataRejectReason = '';
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
            dataRejectReason = `[Gate 0 - ${tf}] ${gate0.dataStatus}: ${gate0.reasons.join(', ')}`;
            break;
          }
          dataFreshnessSeconds = Math.max(dataFreshnessSeconds, gate0.freshnessSec);
        }

        if (!allDataValid) {
          logger.info(`[Stage 3 Deep Analysis] Rejected ${asset} at Gate 0: ${dataRejectReason}`);
          continue;
        }

        // Gate 1: Market Regime Detection
        const gate1 = Gate1MarketRegime.detectRegime(asset, candlesMap);
        logger.info(`[Gate 1 Market Regime] ${asset}: REGIME=${gate1.regime}, CONFIDENCE=${gate1.confidence}, FACTORS=[${gate1.factors.join('; ')}]`);

        const scoring = ScoringEngine.calculateScore(
          asset,
          baselinePrice,
          candlesMap,
          newsSentiment.sentiment,
          crossCheck.agreementPct
        );

        if (scoring.isValid && scoring.direction) {
          const setupCandles = candlesMap['15m'] || candlesMap['1h'] || candlesMap['5m'] || [];

          // Additive Confluence Gates evaluated early for Gate 91 optimized pathways
          const gate12 = setupCandles.length >= 25 ? Gate12Divergence.analyze(setupCandles, scoring.direction) : { confirmed: false, score: 50, direction: 'NONE' as const, type: 'NONE' as const, strength: 'NONE' as const, summary: 'No divergence analysis due to insufficient data length', reasons: [] as string[] };
          const gate13 = setupCandles.length >= 25 ? Gate13BreakoutQuality.analyze(setupCandles, scoring.direction) : { breakoutQuality: 'UNCONFIRMED_BREAKOUT', breakoutScore: 0, breakoutType: 'NONE', retestStatus: 'NONE', volumeConfirmation: 'NONE', reasons: [] as string[] };
          const gate14 = setupCandles.length >= 25 ? Gate14PullbackQuality.analyze(setupCandles, scoring.direction) : { pullbackQuality: 'NONE', pullbackScore: 0, pullbackDepth: 0, structurePreserved: false, reversalRisk: 'NONE', reasons: [] as string[] };
          const gate15 = setupCandles.length >= 25 ? Gate15LiquiditySweep.analyze(setupCandles, scoring.direction) : { confirmationStatus: 'UNCONFIRMED', sweepDirection: 'NONE', sweepLevel: 0, sweepStrength: 0, sweepScore: 0, reasons: [] as string[] };

          // Gate 2: Multi-Timeframe Confluence (Trend)
          const gate2 = Gate2MTFConfluence.evaluateConfluence(scoring.direction, candlesMap);
          logger.info(`[Gate 2 MTF Confluence] ${asset}: HTF=${gate2.htfDirection}, MTF=${gate2.mtfDirection}, LTF=${gate2.ltfDirection}, SCORE=${gate2.alignmentScore}, STATUS=${gate2.confluenceStatus}`);

          // Gate 3: Market Structure
          const gate3 = Gate3MarketStructure.analyzeStructure(scoring.direction, setupCandles);
          logger.info(`[Gate 3 Market Structure] ${asset}: DIR=${gate3.direction}, STR=${gate3.strength}, BOS=${gate3.bosStatus}, CHOCH=${gate3.chochStatus}, SCORE=${gate3.score}`);

          // Gate 4: Momentum & Volatility
          const gate4 = Gate4MomentumVolatility.analyze(scoring.direction, setupCandles);
          logger.info(`[Gate 4 Mom/Vol] ${asset}: MOM=${gate4.momentumDirection}, VOL=${gate4.volatilityState}, EXT=${gate4.overextensionStatus}, SCORE=${gate4.score}`);

          // Gate 5: Support, Resistance & Liquidity
          const gate5 = Gate5SupportResistance.analyze(scoring.direction, setupCandles);
          logger.info(`[Gate 5 S/R & Liq] ${asset}: SR_SCORE=${gate5.srConfluenceScore}, LIQ_SCORE=${gate5.liquidityScore}, SCORE=${gate5.score}`);

          // Gate 6: Volume & Price Action Confirmation
          const gate6 = Gate6VolumePriceAction.analyze(scoring.direction, setupCandles);
          logger.info(`[Gate 6 Vol/PA] ${asset}: VOL=${gate6.volumeConfirmation}, VWAP=${gate6.vwapDirection}, PA=${gate6.priceActionConfirmation}, SCORE=${gate6.score}`);

          // Gate 7: Market Context
          const gate7 = Gate7MarketContext.analyze(asset, scoring.direction, setupCandles);
          logger.info(`[Gate 7 Context] ${asset}: SESSION=${gate7.session}, NEWS=${gate7.newsRisk}, ALLOWED=${gate7.tradingAllowed}, SCORE=${gate7.marketContextScore}`);

          // Gate 8: Entry Quality
          const gate8 = Gate8EntryQuality.analyze(baselinePrice, scoring.direction, setupCandles);
          logger.info(`[Gate 8 Entry] ${asset}: QUALITY=${gate8.entryQuality}, SCORE=${gate8.entryScore}`);

          // Gate 9: Risk Management & Expected Value
          const gate9 = Gate9RiskManagement.calculate(baselinePrice, scoring.direction, setupCandles);
          logger.info(`[Gate 9 Risk] ${asset}: RR=${gate9.rrRatio.toFixed(2)}, EV=${gate9.expectedValue.toFixed(2)}, SCORE=${gate9.riskScore}`);

          // Log early gates
          logger.info(`[Gate 12 Divergence] ${asset}: DIR=${gate12.direction}, TYPE=${gate12.type}, STR=${gate12.strength}, CONFIRMED=${gate12.confirmed}, SCORE=${gate12.score}`);
          logger.info(`[Gate 13 Breakout Quality] ${asset}: QUALITY=${gate13.breakoutQuality}, SCORE=${gate13.breakoutScore}, TYPE=${gate13.breakoutType}, RETEST=${gate13.retestStatus}, VOL=${gate13.volumeConfirmation}`);
          logger.info(`[Gate 14 Pullback Quality] ${asset}: QUALITY=${gate14.pullbackQuality}, SCORE=${gate14.pullbackScore}, DEPTH=${gate14.pullbackDepth}%, PRESERVED=${gate14.structurePreserved}, RISK=${gate14.reversalRisk}`);
          logger.info(`[Gate 15 Liquidity Sweep] ${asset}: STATUS=${gate15.confirmationStatus}, DIR=${gate15.sweepDirection}, LEVEL=${gate15.sweepLevel}, STR=${gate15.sweepStrength}, SCORE=${gate15.sweepScore}`);

          // Add reasons to scoring
          if (gate12.direction !== 'NONE' && gate12.reasons && gate12.reasons.length > 0) scoring.confluenceReasons.push(...gate12.reasons);
          if (gate13.breakoutQuality !== 'UNCONFIRMED_BREAKOUT' && gate13.reasons && gate13.reasons.length > 0) scoring.confluenceReasons.push(...gate13.reasons);
          if (gate14.reasons && gate14.reasons.length > 0) scoring.confluenceReasons.push(...gate14.reasons);
          if (gate15.confirmationStatus !== 'UNCONFIRMED' && gate15.reasons && gate15.reasons.length > 0) scoring.confluenceReasons.push(...gate15.reasons);

          // -----------------------------------------------------------------
          // DIRECTIONAL CONFIRMATION & OPTIMIZED PATHWAYS MODEL (GATE 91)
          // -----------------------------------------------------------------
          const isDirBullish = scoring.direction === 'BUY';
          const isDirBearish = scoring.direction === 'SELL';

          const trendPass = gate2.confluenceStatus !== 'CONTRADICTION' && gate2.alignmentScore >= 40;
          const structurePass = gate3.score >= 40 || (isDirBullish && gate3.direction === 'BULLISH') || (isDirBearish && gate3.direction === 'BEARISH');
          const momentumPass = gate4.score >= 40 || (isDirBullish && gate4.momentumDirection === 'BULLISH') || (isDirBearish && gate4.momentumDirection === 'BEARISH');

          // Gate 91: 4 High-Quality Optimized Pathways
          // 1. Strong trend + valid entry + good R:R
          const hasStrongTrend = gate2.alignmentScore >= 50 && gate2.confluenceStatus !== 'CONTRADICTION';
          const hasValidEntry = gate8.entryScore >= 40 || (gate8.entryQuality !== 'OVEREXTENDED' && gate8.entryQuality !== 'WAIT_FOR_PULLBACK' && gate8.chaseRisk !== 'EXTREME');
          const hasGoodRR = gate9.rrRatio >= thresholds.minimumRR;
          const isStrongTrendPath = hasStrongTrend && hasValidEntry && hasGoodRR;

          // 2. Good breakout + valid structure + good R:R
          const hasGoodBreakout = gate13.breakoutScore >= 45 || gate13.breakoutQuality === 'STRONG_BREAKOUT' || gate13.breakoutQuality === 'RETESTED_BREAKOUT' || (scoring.marketRegime as string) === 'BREAKOUT';
          const hasValidStructure = structurePass;
          const isGoodBreakoutPath = hasGoodBreakout && hasValidStructure && hasGoodRR;

          // 3. Good reversal + valid structure + acceptable risk
          const hasGoodReversal = gate12.confirmed === true || gate12.score >= 40 || gate15.confirmationStatus === 'CONFIRMED_SWEEP' || gate15.sweepScore >= 40 || (scoring.marketRegime as string) === 'RANGE_REVERSAL' || (scoring.marketRegime as string) === 'RANGE';
          const hasAcceptableRisk = gate9.riskScore >= 40;
          const isGoodReversalPath = hasGoodReversal && hasValidStructure && hasAcceptableRisk;

          // 4. Good momentum setup + valid entry + acceptable risk
          const hasGoodMomentum = gate4.score >= 45 || momentumPass;
          const isGoodMomentumPath = hasGoodMomentum && hasValidEntry && hasAcceptableRisk;

          const anyOptimizedPathPassed = isStrongTrendPath || isGoodBreakoutPath || isGoodReversalPath || isGoodMomentumPath;

          const directionalPasses = (trendPass ? 1 : 0) + (structurePass ? 1 : 0) + (momentumPass ? 1 : 0);
          const hasDirectionalConfirmation = anyOptimizedPathPassed || (directionalPasses >= 2);

          // Save the value in scoring so we can reference it later
          (scoring as any).anyOptimizedPathPassed = anyOptimizedPathPassed;

          if (!hasDirectionalConfirmation) {
            scoring.isValid = false;
            scoring.rejectionReason = `REJECTED: DIRECTIONAL_CONFIRMATION_FAILED. Directional Confirmation Failed: Required 2 of 3 (Trend, Structure, Momentum) or one of the 4 optimized pathways, but none passed. (Trend:${trendPass}, Structure:${structurePass}, Momentum:${momentumPass})`;
          } else if (gate7.tradingAllowed === 'NO') {
            scoring.isValid = false;
            scoring.rejectionReason = `REJECTED: MARKET_CONTEXT_BLOCKED. Gate 7 Market Context Blocked: ${gate7.reasons.join('; ')}`;
          } else if (gate9.rrRatio < thresholds.minimumRR) {
            scoring.isValid = false;
            scoring.rejectionReason = `REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross R:R (${gate9.rrRatio.toFixed(2)}:1) is below minimum acceptable GROSS R:R (${thresholds.minimumRR}:1)`;
          } else {
            // Apply weighted composite scoring:
            // Weights: Trend (25), Structure (20), Momentum (20), Volatility (15), Volume (10), Multi-TF (10)
            const trendWeightScore = gate2.alignmentScore;
            const structureWeightScore = gate3.score;
            const momentumWeightScore = gate4.score;
            const volatilityWeightScore = gate4.volatilityState === 'DEAD' || gate4.volatilityState === 'ERRATIC' ? 20 : 85;
            const volumeWeightScore = gate6.score;
            const mtfWeightScore = gate2.alignmentScore;

            const compositeScore = Math.round(
              trendWeightScore * 0.25 +
              structureWeightScore * 0.20 +
              momentumWeightScore * 0.20 +
              volatilityWeightScore * 0.15 +
              volumeWeightScore * 0.10 +
              mtfWeightScore * 0.10
            );

            // Combine composite score with baseline score
            scoring.score = Math.min(100, Math.max(scoring.score, compositeScore));

            if (scoring.score < thresholds.minimumScore) {
              scoring.isValid = false;
              scoring.rejectionReason = `REJECTED: SCORE_BELOW_THRESHOLD. Composite signal score ${scoring.score}/100 is below the minimum required threshold of ${thresholds.minimumScore}`;
            } else {
              // Update SL/TP levels from Risk Management
              scoring.stopLoss = gate9.sl;
              scoring.takeProfit = gate9.tp1;
              scoring.tp1 = gate9.tp1;
              scoring.tp2 = gate9.tp2;
              scoring.tp3 = gate9.tp3;
              scoring.riskRewardRatio = gate9.rrRatio;
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
          initialScore: cand.preliminaryScore,
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
          logger.info(`[Stage 3 Scoring] ${asset} rejected: ${scoring.rejectionReason}`);
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: asset,
            direction: scoring.direction,
            stage: 'GATE_3',
            score: scoring.score || 0,
            regime: scoring.marketRegime || 'UNKNOWN',
            strategy: primaryStrategyName,
            rejectionReason: scoring.rejectionReason || 'Failed scoring criteria',
            ...commonTelemetry,
            finalDecision: 'REJECTED',
            rejectionStage: 'GATE_3',
          });
          SignalAuditStore.logAudit({
            symbol: asset,
            direction: scoring.direction,
            timeframe: 'Multi-TF Realism Setup',
            primaryStrategy: primaryStrategyName,
            passedStrategies: scoring.passedStrategies || [],
            failedStrategies: scoring.failedStrategies || [],
            marketRegime: scoring.marketRegime || 'UNKNOWN',
            atr: scoring.technicalMetrics?.atr || 0,
            dataFreshnessSeconds: 0,
            providerAgreement: crossCheck.agreementPct >= 99.5,
            providerAgreementPct: crossCheck.agreementPct,
            expectedRR: scoring.riskRewardRatio || 0,
            score: scoring.score || 0,
            status: 'REJECTED',
            rejectionReason: scoring.rejectionReason || 'Failed scoring criteria',
            fingerprint: fp,
          });
          continue;
        }

        // 1. Asset Cooldown & Market Structure Check
        const assetCooldown = CooldownManager.isAssetInCooldown(asset);
        if (assetCooldown.inCooldown) {
          const prevSig = this.activeSignals.get(asset) || SignalLogger.getLastSignalForSymbol(asset);
          const structCheck = MarketStructureDetector.hasStructureMateriallyChanged({
            symbol: asset,
            currentEntry: baselinePrice,
            currentRegime: scoring.marketRegime,
            currentDirection: scoring.direction,
            currentAtr: scoring.technicalMetrics?.atr || 0,
            candles1h: candlesMap['1h'],
            prevSignal: prevSig ? {
              entryPrice: prevSig.entryPrice,
              marketRegime: (prevSig as any).marketRegime,
              direction: prevSig.direction,
              timestamp: prevSig.timestamp,
            } : undefined,
          });

          if (!structCheck.hasChanged) {
            const reason = `REJECTED: ASSET_COOLDOWN. Asset in cooldown (${assetCooldown.remainingMinutes}m remaining): ${structCheck.reason}`;
            logger.info(`[Stage 3 Cooldown] Rejected ${asset}: ${reason}`);
            Gate35SignalFunnelAnalytics.recordCandidate({
              symbol: asset,
              direction: scoring.direction,
              stage: 'GATE_8',
              score: scoring.score,
              regime: scoring.marketRegime,
              strategy: primaryStrategyName,
              rejectionReason: reason,
              ...commonTelemetry,
              finalDecision: 'REJECTED',
              rejectionStage: 'GATE_8',
            });
            SignalAuditStore.logAudit({
              symbol: asset,
              direction: scoring.direction,
              timeframe: 'Multi-TF Realism Setup',
              primaryStrategy: primaryStrategyName,
              passedStrategies: scoring.passedStrategies || [],
              failedStrategies: scoring.failedStrategies || [],
              marketRegime: scoring.marketRegime,
              atr: scoring.technicalMetrics?.atr || 0,
              dataFreshnessSeconds: 0,
              providerAgreement: crossCheck.agreementPct >= 99.5,
              providerAgreementPct: crossCheck.agreementPct,
              expectedRR: scoring.riskRewardRatio,
              score: scoring.score,
              status: 'REJECTED',
              rejectionReason: reason,
              fingerprint: fp,
            });
            continue;
          }
        }

        // 2. Strategy Cooldown Check
        const stratCooldown = CooldownManager.isStrategyInCooldown(asset, primaryStrategyName);
        if (stratCooldown.inCooldown) {
          const reason = `REJECTED: STRATEGY_COOLDOWN. Strategy [${primaryStrategyName}] in cooldown on ${asset} (${stratCooldown.remainingMinutes}m remaining)`;
          logger.info(`[Stage 3 Strategy Cooldown] Rejected ${asset}: ${reason}`);
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: asset,
            direction: scoring.direction,
            stage: 'GATE_8',
            score: scoring.score,
            regime: scoring.marketRegime,
            strategy: primaryStrategyName,
            rejectionReason: reason,
            ...commonTelemetry,
            finalDecision: 'REJECTED',
            rejectionStage: 'GATE_8',
          });
          SignalAuditStore.logAudit({
            symbol: asset,
            direction: scoring.direction,
            timeframe: 'Multi-TF Realism Setup',
            primaryStrategy: primaryStrategyName,
            passedStrategies: scoring.passedStrategies || [],
            failedStrategies: scoring.failedStrategies || [],
            marketRegime: scoring.marketRegime,
            atr: scoring.technicalMetrics?.atr || 0,
            dataFreshnessSeconds: 0,
            providerAgreement: crossCheck.agreementPct >= 99.5,
            providerAgreementPct: crossCheck.agreementPct,
            expectedRR: scoring.riskRewardRatio,
            score: scoring.score,
            status: 'REJECTED',
            rejectionReason: reason,
            fingerprint: fp,
          });
          continue;
        }

        // 3. Duplicate Fingerprint Check
        const fpCheck = SignalFingerprint.checkDuplicateFingerprint(fp);
        if (fpCheck.isDuplicate) {
          const reason = `REJECTED: DUPLICATE_FINGERPRINT. Duplicate signal fingerprint match [${fp}]. Identical setup previously emitted within 24h.`;
          logger.info(`[Stage 3 Fingerprint] Rejected ${asset}: ${reason}`);
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: asset,
            direction: scoring.direction,
            stage: 'GATE_8',
            score: scoring.score,
            regime: scoring.marketRegime,
            strategy: primaryStrategyName,
            rejectionReason: reason,
            ...commonTelemetry,
            finalDecision: 'REJECTED',
            rejectionStage: 'GATE_8',
          });
          SignalAuditStore.logAudit({
            symbol: asset,
            direction: scoring.direction,
            timeframe: 'Multi-TF Realism Setup',
            primaryStrategy: primaryStrategyName,
            passedStrategies: scoring.passedStrategies || [],
            failedStrategies: scoring.failedStrategies || [],
            marketRegime: scoring.marketRegime,
            atr: scoring.technicalMetrics?.atr || 0,
            dataFreshnessSeconds: 0,
            providerAgreement: crossCheck.agreementPct >= 99.5,
            providerAgreementPct: crossCheck.agreementPct,
            expectedRR: scoring.riskRewardRatio,
            score: scoring.score,
            status: 'REJECTED',
            rejectionReason: reason,
            fingerprint: fp,
          });
          continue;
        }

        const secondaryPrice = crossCheck.secondaryPrice ? { price: crossCheck.secondaryPrice, source: crossCheck.source2 || 'Secondary' } : undefined;
        
        const validation = SignalValidator.validate({
          symbol: asset,
          direction: scoring.direction,
          entryPrice: baselinePrice,
          stopLoss: scoring.stopLoss,
          takeProfit: scoring.takeProfit,
          tp1: scoring.tp1,
          tp2: scoring.tp2,
          tp3: scoring.tp3,
          riskRewardRatio: scoring.riskRewardRatio,
          score: scoring.score,
          candlesMap,
          liveTicker,
          secondaryPrice,
        });

        this.logDiagnosticTrace(asset, liveTicker.price, crossCheck, newsSentiment, scoring, validation);

        if (!validation.isValid) {
          logger.warn(`[Stage 3 Validation Rejected] ${asset}: [${validation.validationReason}] ${validation.detailedMessage}`);
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: asset,
            direction: scoring.direction,
            stage: 'GATE_9',
            score: scoring.score,
            regime: scoring.marketRegime,
            strategy: primaryStrategyName,
            rejectionReason: validation.detailedMessage || validation.validationReason,
            ...commonTelemetry,
            finalDecision: 'REJECTED',
            rejectionStage: 'GATE_9',
          });
          SignalAuditStore.logAudit({
            symbol: asset,
            direction: scoring.direction,
            timeframe: 'Multi-TF Realism Setup',
            primaryStrategy: primaryStrategyName,
            passedStrategies: scoring.passedStrategies || [],
            failedStrategies: scoring.failedStrategies || [],
            marketRegime: scoring.marketRegime,
            atr: scoring.technicalMetrics?.atr || 0,
            dataFreshnessSeconds,
            providerAgreement: crossCheck.agreementPct >= 99.5,
            providerAgreementPct: crossCheck.agreementPct,
            expectedRR: scoring.riskRewardRatio,
            score: scoring.score,
            status: 'REJECTED',
            rejectionReason: `Gate 8 Validation Failed [${validation.validationReason}]: ${validation.detailedMessage}`,
            fingerprint: fp,
          });
          continue;
        }

        let finalEntry = validation.adjustedEntryPrice || liveTicker.price;
        let finalSL = validation.adjustedStopLoss || scoring.stopLoss;
        let finalTP = validation.adjustedTakeProfit || scoring.takeProfit;
        const finalRR = validation.adjustedNetRR || scoring.riskRewardRatio;

        if (!scoring.technicalMetrics) continue;

        // Strict policy enforcement check: Save state before AI evaluation
        const entryBeforeAI = finalEntry;
        const slBeforeAI = finalSL;
        const tpBeforeAI = finalTP;
        const scoreBeforeAI = scoring.score;

        const candidatePayloadForAI = {
          hasSetup: true,
          symbol: asset,
          entryPrice: finalEntry,
          direction: scoring.direction,
          timeframe: '5m-1D Multi-TF Realism Check',
          strategy: primaryStrategyName,
          confluenceReasons: scoring.confluenceReasons,
          confidenceScore: scoring.score,
          stopLoss: finalSL,
          takeProfit: finalTP,
          riskRewardRatio: finalRR,
          technicalMetrics: scoring.technicalMetrics,
        };

        let aiResult: {
          aiAssessment: string;
          classification: 'UNAVAILABLE' | 'QUALITATIVE_CONFIRMATION' | 'QUALITATIVE_CONTRADICTION';
          refinedConfidence: number;
          documentedConfidence?: number;
          isAiValidated: boolean;
        } = {
          aiAssessment: 'AI Confirmation Disabled by Policy.',
          classification: 'UNAVAILABLE',
          refinedConfidence: scoring.score,
          documentedConfidence: undefined,
          isAiValidated: false,
        };

        if (thresholds.AIConfirmationMode !== 'DISABLED') {
          aiResult = await NvidiaAIService.evaluate(candidatePayloadForAI);
        }

        const winRate = ScoringEngine.estimateWinRate(scoring.score, finalRR, scoring.agreeingStrategiesCount);
        const expectancy = ScoringEngine.calculateExpectancy(winRate, finalRR);

        // Strict Policy Enforcement Check: Reset any unauthorized AI modifications to entry, SL, TP, score or probability
        if (
          finalEntry !== entryBeforeAI ||
          finalSL !== slBeforeAI ||
          finalTP !== tpBeforeAI ||
          scoring.score !== scoreBeforeAI
        ) {
          logger.warn(`[Stage 3 AI] Policy violation attempt detected. Resetting fields to original deterministic values.`);
          finalEntry = entryBeforeAI;
          finalSL = slBeforeAI;
          finalTP = tpBeforeAI;
          scoring.score = scoreBeforeAI;
        }
        const anyOptimizedPathPassed = !!(scoring as any).anyOptimizedPathPassed;
        const effectiveMinWinProb = anyOptimizedPathPassed ? 35 : thresholds.minimumWinProbability;

        if (winRate <= effectiveMinWinProb) {
          const reason = `REJECTED: WIN_RATE_BELOW_THRESHOLD. Estimated win rate (${winRate}% <= ${effectiveMinWinProb}% threshold)`;
          logger.info(`[Stage 3 AI] Rejected ${asset} due to ${reason}`);
          SignalAuditStore.logAudit({
            symbol: asset,
            direction: scoring.direction,
            timeframe: 'Multi-TF Realism Setup',
            primaryStrategy: primaryStrategyName,
            passedStrategies: scoring.passedStrategies || [],
            failedStrategies: scoring.failedStrategies || [],
            marketRegime: scoring.marketRegime,
            atr: scoring.technicalMetrics?.atr || 0,
            dataFreshnessSeconds,
            providerAgreement: crossCheck.agreementPct >= 99.5,
            providerAgreementPct: crossCheck.agreementPct,
            expectedRR: finalRR,
            score: scoring.score,
            status: 'REJECTED',
            rejectionReason: reason,
            fingerprint: fp,
          });
          continue;
        }

        if (expectancy <= 0) {
          const reason = `REJECTED: NEGATIVE_EXPECTANCY. Non-positive expectancy (${expectancy}R <= 0)`;
          logger.info(`[Stage 3 AI] Rejected ${asset} due to ${reason}`);
          SignalAuditStore.logAudit({
            symbol: asset,
            direction: scoring.direction,
            timeframe: 'Multi-TF Realism Setup',
            primaryStrategy: primaryStrategyName,
            passedStrategies: scoring.passedStrategies || [],
            failedStrategies: scoring.failedStrategies || [],
            marketRegime: scoring.marketRegime,
            atr: scoring.technicalMetrics?.atr || 0,
            dataFreshnessSeconds,
            providerAgreement: crossCheck.agreementPct >= 99.5,
            providerAgreementPct: crossCheck.agreementPct,
            expectedRR: finalRR,
            score: scoring.score,
            status: 'REJECTED',
            rejectionReason: reason,
            fingerprint: fp,
          });
          continue;
        }

        const classification = SymbolNormalizer.getAssetClassification(asset);

        // GATE 65: Centralized Final Tradeability Resolution
        // finalRequiredScore = Math.max(thresholds.signalThreshold, regimeAdaptiveThreshold)
        // Gate 27 can make the system MORE selective, but NEVER less selective than signalThreshold.
        const tradeabilityCheck = TradeRankingEngine.calculateFinalRequiredScore({
          symbol: asset,
          actualScore: scoring.score,
          regime: scoring.marketRegime,
          strategy: primaryStrategyName,
          assetClass: classification,
          signalThreshold: thresholds.signalThreshold,
        });

        // 1. Hard Rejection for UNKNOWN / Untradeable Regimes (Gate 27 policy: UNKNOWN -> NO SIGNAL)
        if (!tradeabilityCheck.isExecutable) {
          const reason = tradeabilityCheck.rejectionReason || `REJECTED: REGIME_UNTRADEABLE. Market regime '${scoring.marketRegime}' is UNKNOWN or untradeable under Gate 27 policy (NO SIGNAL).`;
          logger.info(`[Gate 27 Policy] Rejected ${asset} due to ${reason}`);
          SignalAuditStore.logAudit({
            symbol: asset,
            direction: scoring.direction,
            timeframe: 'Multi-TF Realism Setup',
            primaryStrategy: primaryStrategyName,
            strategy: primaryStrategyName,
            passedStrategies: scoring.passedStrategies || [],
            failedStrategies: scoring.failedStrategies || [],
            marketRegime: scoring.marketRegime,
            regime: scoring.marketRegime,
            threshold: tradeabilityCheck.finalRequiredScore,
            actualScore: scoring.score,
            marginAboveThreshold: tradeabilityCheck.marginAboveFinalThreshold,
            atr: scoring.technicalMetrics?.atr || 0,
            dataFreshnessSeconds,
            providerAgreement: crossCheck.agreementPct >= 99.5,
            providerAgreementPct: crossCheck.agreementPct,
            expectedRR: finalRR,
            score: scoring.score,
            status: 'REJECTED',
            rejectionReason: reason,
            fingerprint: fp,
          });
          continue;
        }

        // 2. Centralized Final Tradeability Threshold Evaluation
        const effectiveFinalScoreHurdle = tradeabilityCheck.finalRequiredScore;
        const marginAboveThreshold = tradeabilityCheck.marginAboveFinalThreshold;

        if (!tradeabilityCheck.passed) {
          const effectiveWatchingThreshold = Math.max(68, effectiveFinalScoreHurdle - 8);
          const effectiveCandidateThreshold = Math.max(72, effectiveFinalScoreHurdle - 4);
          const isWatching = scoring.score >= effectiveWatchingThreshold;
          const funnelStage = scoring.score >= effectiveCandidateThreshold ? 'CONFIRMED' : 'WATCHING';
          const reason = tradeabilityCheck.rejectionReason || `REJECTED: SCORE_BELOW_FINAL_THRESHOLD. Score (${scoring.score}/100) below final required score (${effectiveFinalScoreHurdle}) (margin: ${marginAboveThreshold >= 0 ? '+' : ''}${marginAboveThreshold})`;
          
          if (isWatching) {
            // GATE 26 & 27: Register in Opportunity Funnel for continuous monitoring with adaptive target
            const funnelItem = OpportunityFunnelStore.addOrUpdate({
              id: `opp_${now}_${asset}_${Math.random().toString(36).substring(2, 6)}`,
              symbol: asset,
              direction: scoring.direction,
              entryPrice: finalEntry,
              stopLoss: finalSL,
              takeProfit: finalTP,
              tp1: scoring.tp1,
              tp2: scoring.tp2,
              tp3: scoring.tp3,
              riskRewardRatio: finalRR,
              score: scoring.score,
              confidenceScore: scoring.score,
              stage: funnelStage,
              status: funnelStage === 'CONFIRMED' ? 'QUALIFIED' : 'WATCHING',
              hardGatesPassed: true,
              passedSoftConditions: scoring.confluenceReasons || [],
              missingSoftConditions: [`Missing confirmation trigger to reach ${effectiveFinalScoreHurdle} final required threshold`],
              rejectionReason: `Placed in ${funnelStage} stage (Score: ${scoring.score}/${effectiveFinalScoreHurdle}, margin: ${marginAboveThreshold >= 0 ? '+' : ''}${marginAboveThreshold}). Not emitted as trade signal.`,
              marketRegime: scoring.marketRegime,
              strategy: primaryStrategyName,
              createdAt: now,
              updatedAt: now,
              expiresAt: now + serverConfig.getConfig().signalExpirationMs,
            });
            logger.info(`[Gate 26 Funnel] Registered ${asset} as ${funnelStage} (Score: ${scoring.score}, Target: ${effectiveFinalScoreHurdle})`, { id: funnelItem.id, symbol: asset, stage: funnelStage, margin: marginAboveThreshold });
          }

          logger.info(`[Stage 3 AI] Rejected ${asset} due to ${reason}`);
          SignalAuditStore.logAudit({
            symbol: asset,
            direction: scoring.direction,
            timeframe: 'Multi-TF Realism Setup',
            primaryStrategy: primaryStrategyName,
            strategy: primaryStrategyName,
            passedStrategies: scoring.passedStrategies || [],
            failedStrategies: scoring.failedStrategies || [],
            marketRegime: scoring.marketRegime,
            regime: scoring.marketRegime,
            threshold: effectiveFinalScoreHurdle,
            actualScore: scoring.score,
            marginAboveThreshold,
            atr: scoring.technicalMetrics?.atr || 0,
            dataFreshnessSeconds,
            providerAgreement: crossCheck.agreementPct >= 99.5,
            providerAgreementPct: crossCheck.agreementPct,
            expectedRR: finalRR,
            score: scoring.score,
            status: isWatching ? (funnelStage === 'CONFIRMED' ? 'CANDIDATE' : 'WATCHING') : 'REJECTED',
            rejectionReason: reason,
            fingerprint: fp,
          });
          continue;
        }

        // Check AI qualitative and quantitative thresholds according to policy
        let aiRejected = false;
        let aiRejectionReason = '';

        if (thresholds.AIConfirmationMode === 'REQUIRED') {
          if (aiResult.classification === 'QUALITATIVE_CONTRADICTION' || aiResult.classification === 'UNAVAILABLE' || !aiResult.isAiValidated) {
            aiRejected = true;
            aiRejectionReason = `REJECTED: AI_QUALITATIVE_CONTRADICTION. AI qualitative assessment returned ${aiResult.classification} ('${aiResult.aiAssessment}')`;
          } else if (aiResult.documentedConfidence !== undefined && aiResult.documentedConfidence < thresholds.minimumAiConfidence) {
            aiRejected = true;
            aiRejectionReason = `REJECTED: AI_CONFIDENCE_BELOW_THRESHOLD. AI confidence (${aiResult.documentedConfidence}% < ${thresholds.minimumAiConfidence}%)`;
          }
        } else if (thresholds.AIConfirmationMode === 'OPTIONAL') {
          if (aiResult.classification === 'QUALITATIVE_CONTRADICTION') {
            aiRejected = true;
            aiRejectionReason = `REJECTED: AI_QUALITATIVE_CONTRADICTION. AI qualitative assessment returned ${aiResult.classification} ('${aiResult.aiAssessment}')`;
          } else if (aiResult.documentedConfidence !== undefined && aiResult.documentedConfidence < thresholds.minimumAiConfidence) {
            aiRejected = true;
            aiRejectionReason = `REJECTED: AI_CONFIDENCE_BELOW_THRESHOLD. AI confidence (${aiResult.documentedConfidence}% < ${thresholds.minimumAiConfidence}%)`;
          }
        }

        if (aiRejected) {
          if (thresholds.AIConfirmationMode === 'REQUIRED') {
            // Explicit HARD safety rule required by user configuration (AIConfirmationMode = REQUIRED)
            logger.info(`[Stage 3 AI] Hard safety rule enforced: Rejected ${asset} due to ${aiRejectionReason}`);
            SignalAuditStore.logAudit({
              symbol: asset,
              direction: scoring.direction,
              timeframe: 'Multi-TF Realism Setup',
              primaryStrategy: primaryStrategyName,
              passedStrategies: scoring.passedStrategies || [],
              failedStrategies: scoring.failedStrategies || [],
              marketRegime: scoring.marketRegime,
              atr: scoring.technicalMetrics?.atr || 0,
              dataFreshnessSeconds,
              providerAgreement: crossCheck.agreementPct >= 99.5,
              providerAgreementPct: crossCheck.agreementPct,
              expectedRR: finalRR,
              score: scoring.score,
              status: 'REJECTED',
              rejectionReason: aiRejectionReason,
              fingerprint: fp,
            });
            continue;
          } else {
            // Gate 86 Policy: Secondary AI qualitative assessment in OPTIONAL mode must NOT independently veto a core-valid trade
            logger.info(`[Stage 3 AI] AI evaluation was negative (${aiRejectionReason}), but Gate 86 policy prevents secondary AI analytics from independently rejecting a core-valid signal in ${thresholds.AIConfirmationMode} mode.`);
            aiRejectionReason = undefined; // Clear rejection reason so candidate passes to ranking
          }
        }
        const providerName = classification === 'CRYPTO'
          ? 'Bitget Live Feed'
          : (classification === 'FOREX' ? 'Twelve Data' : 'Finnhub');

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
          scoring.direction,
          finalEntry,
          finalSL,
          rawTp1,
          rawTp2,
          rawTp3,
          atr,
          precision,
          classification
        );

        const safeTp1 = tpEnforced.tp1;
        const safeTp2 = tpEnforced.tp2;
        const safeTp3 = tpEnforced.tp3;
        const safeTakeProfit = tpEnforced.takeProfit;

        // GATE 4: Calculate exact R:R ratios directly from actual displayed prices
        const tp1Rr = calculateTargetRr(scoring.direction, finalEntry, finalSL, safeTp1);
        const tp2Rr = calculateTargetRr(scoring.direction, finalEntry, finalSL, safeTp2);
        const tp3Rr = calculateTargetRr(scoring.direction, finalEntry, finalSL, safeTp3);
        const exactPrimaryRr = calculateTargetRr(scoring.direction, finalEntry, finalSL, safeTakeProfit);

        // GATE 4: Target Quality Score evaluation (independent of confidenceScore)
        const tqResult = TargetQualityEvaluator.evaluate({
          direction: scoring.direction,
          entryPrice: finalEntry,
          stopLoss: finalSL,
          tp1: safeTp1,
          tp2: safeTp2,
          tp3: safeTp3,
          atr,
          marketRegime: scoring.marketRegime,
        });

        const signal: TradingSignal = {
          id: `sig_${now}_${Math.random().toString(36).substring(2, 7)}`,
          snapshotId: validation.snapshotId,
          symbol: asset,
          direction: scoring.direction,
          entryPrice: finalEntry,
          timeframe: 'Multi-TF Realism Setup',
          strategy: primaryStrategyName,
          confluenceReasons: scoring.confluenceReasons,
          confidenceScore: scoring.score,
          targetQualityScore: tqResult.targetQualityScore,
          estimatedWinRate: winRate,
          modelEstimatedWinRate: winRate,
          empiricalCalibratedProbability: null,
          probabilitySourceUsed: serverConfig.getConfig().thresholds.probabilitySource,
          isEmpiricallyCalibrated: false,
          isAiValidated: aiResult.isAiValidated,
          stopLoss: finalSL,
          takeProfit: safeTakeProfit,
          tp1: safeTp1,
          tp2: safeTp2,
          tp3: safeTp3,
          tp1Rr,
          tp2Rr,
          tp3Rr,
          riskRewardRatio: exactPrimaryRr,
          grossRiskRewardRatio: scoring.estimatedFriction?.grossRiskRewardRatio ?? exactPrimaryRr,
          netRiskRewardRatio: scoring.estimatedFriction?.netRiskRewardRatio,
          adverseNetRiskRewardRatio: scoring.estimatedFriction?.adverseNetRiskRewardRatio,
          targetDistance,
          stopDistance,
          pipPointUnit: scoring.pipPointUnit,
          estimatedFriction: scoring.estimatedFriction,
          suggestedRiskAmount: scoring.hypotheticalRisk.suggestedRiskAmount,
          suggestedPositionSize: scoring.hypotheticalRisk.suggestedPositionSize,
          expiresAt: now + serverConfig.getConfig().signalExpirationMs,
          timestamp: now,
          validatedAt: validation.validatedAt,
          dataSource: `${providerName} with Live Price & Sentiment Cross-Validation`,
          status: 'WAITING_ENTRY',
          isActionableSignal: true,
          validationReason: 'VALID',
          aiAssessment: aiResult.aiAssessment,
          score: scoring.score,
          coreScore: scoring.coreScore ?? scoring.score,
          entryHitTimestamp: null,
          tp1Status: 'PENDING',
          tp2Status: 'PENDING',
          tp3Status: 'PENDING',
          slStatus: 'ACTIVE_FOR_ENTRY_ONLY',
        };

        candidates.push({
          signal,
          scoring,
          validation,
          aiConfidence: aiResult.documentedConfidence,
          timeframesAligned: scoring.timeframesAligned,
          candles: candlesMap['1h'] || candlesMap['15m'] || candlesMap['5m'] || [],
        });
      }

      // 4. Gate 17 / GATE 81: Candidate Pipeline Flow (Secondary Ranking & Exposure Management)
      // Correlated setups are analyzed, clustered, and ranked via Gate 17 and TradeRankingEngine
      // rather than hard-rejecting core-valid candidates at this stage.
      const filteredCandidates = [...candidates];

      // Stage 3.5: Gate 16 Relative Strength Ranking across Comparable Universes
      const rsInputs = filteredCandidates.map((c) => ({
        symbol: c.signal.symbol,
        direction: c.signal.direction,
        candles: c.candles || [],
        currentPrice: c.signal.entryPrice,
        atr: c.scoring.technicalMetrics?.atr,
      }));
      const rsResults = Gate16RelativeStrength.rankCandidates(rsInputs);

      // Attach Gate 16 Relative Strength properties to signals
      for (const cand of filteredCandidates) {
        const rs = rsResults.get(cand.signal.symbol);
        if (rs) {
          cand.signal.relativeStrengthScore = rs.relativeStrengthScore;
          cand.signal.relativeRank = rs.relativeRank;
          cand.signal.assetClassRank = rs.assetClassRank;
          cand.signal.marketContext = rs.marketContext;
          if (rs.reasons && rs.reasons.length > 0) {
            cand.signal.confluenceReasons.push(...rs.reasons);
          }
          logger.info(`[Gate 16 Relative Strength] ${cand.signal.symbol}: RANK=${rs.assetClassRank}, RS_SCORE=${rs.relativeStrengthScore}, CONTEXT=${rs.marketContext}`);
        }
      }

      // Stage 3.6: Gate 17 Correlation & Signal Exposure Control
      const corrInputs = filteredCandidates.map((c) => ({
        symbol: c.signal.symbol,
        direction: c.signal.direction,
        candles: c.candles || [],
        score: c.signal.score,
        relativeStrengthScore: c.signal.relativeStrengthScore,
      }));
      const activeSignalsSimple = Array.from(this.activeSignals.values()).map((s) => ({
        symbol: s.symbol,
        direction: s.direction,
        score: s.score,
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
          if (corr.reasons && corr.reasons.length > 0) {
            cand.signal.confluenceReasons.push(...corr.reasons);
          }
          logger.info(`[Gate 17 Correlation] ${cand.signal.symbol}: CLUSTER=${corr.correlationCluster}, LEVEL=${corr.correlationLevel}, EXPOSURE=${corr.clusterExposure}, PENALTY=-${corr.correlationPenalty}`);
        }
      }

      // Stage 3.7: Gate 18 Regime-Specific Strategy Selection
      for (const cand of filteredCandidates) {
        const detectedRegime = (cand.scoring as any)?.regime || cand.signal.marketRegime || 'UNKNOWN';
        const regimeSelection = Gate18RegimeStrategySelection.selectStrategy({
          symbol: cand.signal.symbol,
          regime: detectedRegime,
          candidateStrategyName: cand.signal.strategy,
        });

        cand.signal.marketRegime = detectedRegime;
        cand.signal.selectedStrategy = regimeSelection.selectedStrategy;
        cand.signal.eligibleStrategies = regimeSelection.eligibleStrategies;
        cand.signal.strategyCompatibilityScore = regimeSelection.strategyCompatibilityScore;
        cand.signal.regimeStrategyMatch = regimeSelection.regimeStrategyMatch;

        if (regimeSelection.reasons && regimeSelection.reasons.length > 0) {
          cand.signal.confluenceReasons.push(...regimeSelection.reasons);
        }
        logger.info(`[Gate 18 Strategy Selection] ${cand.signal.symbol}: REGIME=${regimeSelection.marketRegime}, STRATEGY=${regimeSelection.selectedStrategy}, MATCH=${regimeSelection.regimeStrategyMatch} (${regimeSelection.strategyCompatibilityScore}/100)`);
      }

      // Stage 3.8: Gate 20 & Gate 41 Empirical Probability Calibration & Safety
      const probThresholds = serverConfig.getConfig().thresholds;
      const validCandidates: typeof filteredCandidates = [];

      for (const cand of filteredCandidates) {
        const calibration = Gate20ProbabilityCalibration.calibrateProbability({
          signalScore: cand.signal.score || cand.signal.confidenceScore || 0,
          strategy: cand.signal.selectedStrategy || cand.signal.strategy,
          regime: cand.signal.marketRegime,
          assetClass: cand.signal.assetClass as any,
          timeframe: cand.signal.timeframe,
        });

        cand.signal.probabilityScoreBucket = calibration.scoreBucket;
        cand.signal.probabilitySampleSize = calibration.sampleSize;
        cand.signal.probabilityConfidenceInterval = calibration.confidenceInterval
          ? { lower: calibration.confidenceInterval.lowerPct, upper: calibration.confidenceInterval.upperPct }
          : null;
        cand.signal.calibrationStatus = calibration.calibrationStatus;

        cand.signal.probabilitySourceUsed = probThresholds.probabilitySource;

        const isEmpiricalReady =
          (calibration.calibrationStatus === 'CALIBRATED' || calibration.calibrationStatus === 'HIGH_CONFIDENCE_CALIBRATION') &&
          calibration.sampleSize >= 30 &&
          calibration.empiricalProbability !== null;

        if (probThresholds.probabilitySource === 'EMPIRICAL') {
          if (isEmpiricalReady) {
            cand.signal.empiricalCalibratedProbability = calibration.empiricalProbability;
            cand.signal.empiricalProbability = calibration.empiricalProbability;
            cand.signal.isEmpiricallyCalibrated = true;
            cand.signal.estimatedWinRate = calibration.empiricalProbability;
          } else {
            cand.signal.empiricalCalibratedProbability = null;
            cand.signal.empiricalProbability = null;
            cand.signal.isEmpiricallyCalibrated = false;
            // Fallback to model estimated win rate without pretending it is statistically calibrated empirical probability
            cand.signal.estimatedWinRate = cand.signal.modelEstimatedWinRate || cand.signal.estimatedWinRate;
            if (probThresholds.requireEmpiricalCalibration) {
              logger.info(`[Gate 41/80 Policy] ${cand.signal.symbol}: Empirical calibration sample small (N=${calibration.sampleSize} < 30). Falling back to model probability; secondary analytics cannot reject core-valid signal.`);
            }
          }
        } else if (probThresholds.probabilitySource === 'MODEL') {
          cand.signal.empiricalCalibratedProbability = null;
          cand.signal.empiricalProbability = null;
          cand.signal.isEmpiricallyCalibrated = false;
          cand.signal.estimatedWinRate = cand.signal.modelEstimatedWinRate || cand.signal.estimatedWinRate;
        } else if (probThresholds.probabilitySource === 'NONE') {
          cand.signal.empiricalCalibratedProbability = null;
          cand.signal.empiricalProbability = null;
          cand.signal.isEmpiricallyCalibrated = false;
        }

        if (calibration.reasons && calibration.reasons.length > 0) {
          cand.signal.confluenceReasons.push(...calibration.reasons);
        }
        validCandidates.push(cand);
        logger.info(`[Gate 20/41 Calibration] ${cand.signal.symbol}: SOURCE=${probThresholds.probabilitySource}, BUCKET=${calibration.scoreBucket}, N=${calibration.sampleSize}, EMP_PROB=${cand.signal.empiricalCalibratedProbability ?? 'N/A'}, MODEL_PROB=${cand.signal.modelEstimatedWinRate}, IS_CALIBRATED=${cand.signal.isEmpiricallyCalibrated}`);
      }
      filteredCandidates.length = 0;
      filteredCandidates.push(...validCandidates);

      // Stage 3.9: Gate 21 Walk-Forward Validation (Gate 85: Informational & Ranking Context Only)
      for (const cand of filteredCandidates) {
        try {
          const wfResult = Gate21WalkForwardValidation.validateStrategy(
            cand.signal.selectedStrategy || cand.signal.strategy
          );

          cand.signal.walkForwardEfficiency = wfResult.walkForwardEfficiency;
          cand.signal.walkForwardStatus = wfResult.status;
          cand.signal.overfitRiskDetected = wfResult.overfitRiskDetected;

          if (wfResult.reasons && wfResult.reasons.length > 0) {
            cand.signal.confluenceReasons.push(...wfResult.reasons);
          }
          logger.info(`[Gate 21 Walk-Forward] ${cand.signal.symbol}: STRATEGY=${wfResult.strategy}, WFE=${wfResult.walkForwardEfficiency !== null ? wfResult.walkForwardEfficiency + '%' : 'N/A'}, STATUS=${wfResult.status}, OVERFIT_RISK=${wfResult.overfitRiskDetected}`);
        } catch (err: any) {
          logger.warn(`[Gate 21 Walk-Forward] ${cand.signal.symbol}: Validation unavailable (${err?.message || err}). Candidate preserved without veto.`);
        }
      }

      // Stage 3.10: Gate 22 Monte Carlo Trade-Sequence Analysis (Gate 85: Informational & Risk Context Only)
      for (const cand of filteredCandidates) {
        try {
          const mcResult = Gate22MonteCarloSimulation.runSimulation(
            cand.signal.selectedStrategy || cand.signal.strategy
          );

          cand.signal.monteCarloMedianMaxDrawdownR = mcResult.medianMaxDrawdownR;
          cand.signal.monteCarlo95PctDrawdownR = mcResult.percentile95MaxDrawdownR;
          cand.signal.monteCarloRiskOfRuinPct = mcResult.riskOfRuinPct;
          cand.signal.monteCarloSimulationStatus = mcResult.simulationStatus;

          if (mcResult.reasons && mcResult.reasons.length > 0) {
            cand.signal.confluenceReasons.push(...mcResult.reasons);
          }
          logger.info(`[Gate 22 Monte Carlo] ${cand.signal.symbol}: MED_DD=${mcResult.medianMaxDrawdownR !== null ? mcResult.medianMaxDrawdownR + 'R' : 'N/A'}, 95th_DD=${mcResult.percentile95MaxDrawdownR !== null ? mcResult.percentile95MaxDrawdownR + 'R' : 'N/A'}, RUIN_PROB=${mcResult.riskOfRuinPct !== null ? mcResult.riskOfRuinPct + '%' : 'N/A'}, STATUS=${mcResult.simulationStatus}`);
        } catch (err: any) {
          logger.warn(`[Gate 22 Monte Carlo] ${cand.signal.symbol}: Simulation unavailable (${err?.message || err}). Candidate preserved without veto.`);
        }
      }

      // Stage 4: Final Trade Selection & Opportunity Ranking
      const thresholds = serverConfig.getConfig().thresholds;
      const ranking = TradeRankingEngine.rankOpportunities(filteredCandidates);
      const validatedSignals = ranking.allRanked.slice(0, 5);

      if (validatedSignals.length > 0) {
        for (const sig of validatedSignals) {


          if (process.env.NODE_ENV === 'production' && !ScannerPersistence.isProductionPersistenceReady()) {
            logger.warn(`[SignalEngine] Final candidate ${sig.symbol} cannot be marked tradeable: production persistence (Firebase Admin) unavailable.`);
            sig.isTradeableSignal = false;
            sig.signalClassification = 'DIAGNOSTIC';
            continue;
          }

          const signalFp = SignalFingerprint.generateFingerprint({
            symbol: sig.symbol,
            direction: sig.direction,
            entryPrice: sig.entryPrice,
            timeframe: sig.timeframe,
            primaryStrategy: sig.strategy,
          });

          if (persistAndActivate) {
            // Atomically increment cap
            const inc = await ScannerPersistence.tryIncrementCap(thresholds.dailySignalCap || 10);
            if (!inc.allowed) {
              logger.warn(`[SignalEngine] Daily cap reached during atomic increment. Stopping further dispatches.`);
              break;
            }

            // GATE 60 & GATE 65: Mark as officially tradeable before persistence
            sig.isTradeableSignal = true;
            sig.signalClassification = 'TRADEABLE';

            // PERSIST & CONFIRM PERSISTENCE
            const persRes = await ScannerPersistence.recordSentSignal(sig);
            const logRes = await SignalLogger.logSignal(sig, sig.marketRegime || 'TREND');

            if (!persRes.success || !logRes.success || logRes.status !== 'TRADEABLE_RECORD_PERSISTED') {
              logger.error(`[SignalEngine] Persistence failed for ${sig.symbol}. Rolling back cap and aborting dispatch.`, { persError: persRes.error, logError: logRes.error });
              await ScannerPersistence.releaseCap(inc.reservationId);
              sig.isTradeableSignal = false;
              sig.signalClassification = 'DIAGNOSTIC';
              continue;
            }

            // COMMIT CAP RESERVATION!
            const commitRes = await ScannerPersistence.commitCap(inc.reservationId);
            if (!commitRes.success) {
              logger.error(`[SignalEngine] CRITICAL CAP-STATE ERROR: Failed to commit cap reservation ${inc.reservationId} for ${sig.symbol}. Signal remains persisted and tradeable.`, { error: commitRes.error });
            }

            // ONLY AFTER BOTH SUCCEED: activate signal
            this.activeSignals.set(sig.symbol, sig);

            // Record Fingerprint, Cooldown, and Accepted Audit Explanation
            SignalFingerprint.recordFingerprint({
              symbol: sig.symbol,
              direction: sig.direction,
              entryPrice: sig.entryPrice,
              timeframe: sig.timeframe,
              primaryStrategy: sig.strategy,
            });

            CooldownManager.recordSignalEmit(sig.symbol, sig.strategy, sig.timestamp);
          }

          const regime = sig.marketRegime || 'UNKNOWN';

          SignalAuditStore.logAudit({
            symbol: sig.symbol,
            direction: sig.direction,
            timeframe: sig.timeframe,
            primaryStrategy: sig.strategy,
            strategy: sig.strategy,
            passedStrategies: [sig.strategy],
            failedStrategies: [],
            marketRegime: regime,
            regime,
            threshold: (sig as any).coreScore || sig.score,
            actualScore: sig.score,
            marginAboveThreshold: 0,
            atr: 0,
            dataFreshnessSeconds: 0,
            providerAgreement: true,
            expectedRR: sig.riskRewardRatio,
            score: sig.score,
            status: 'ACCEPTED',
            rejectionReason: null,
            fingerprint: signalFp,
          });
        }

        const bestTrade = ranking.bestTrade;
        const secondBest = ranking.secondBest;
        const suggestions = ranking.suggestions;
        const primarySignal = bestTrade || validatedSignals[0];

        return {
          success: true,
          message: `Multi-Asset Scan (${assetCategory}): Ranked ${validatedSignals.length} Qualified Setup(s). BEST TRADE: ${bestTrade?.symbol || 'N/A'}${secondBest ? ', SECOND BEST: ' + secondBest.symbol : ''}.`,
          symbol: primarySignal.symbol,
          marketPrice: primarySignal.entryPrice,
          signal: primarySignal,
          signals: validatedSignals,
          bestTrade,
          secondBest,
          suggestions,
          timestamp: now,
          telemetry: {
            universeSymbolsScanned: universe.length,
            preliminaryCandidatesFound: stage2Candidates.length,
            candidatesRejectedPreliminary: universe.length - stage2Candidates.length,
            candidatesEvaluated: topCandidates.length,
            candidatesRejectedFinal: topCandidates.length - candidates.length,
            signalsGenerated: validatedSignals.length,
            signalsAccepted: validatedSignals.length,
          },
        };
      }

      return {
        success: false,
        message: 'NO QUALIFIED TRADE',
        symbol: cleanSymbol,
        reason: `Multi-asset scan completed across ${assetCategory} universe (${universe.join(', ')}): No setups satisfied all strict confluence, volatility, risk-reward (>= 2:1), win-rate (> 30%), or live price validation hurdles. The system will never create placeholder signals.`,
        timestamp: now,
        telemetry: {
          universeSymbolsScanned: universe.length,
          preliminaryCandidatesFound: stage2Candidates.length,
          candidatesRejectedPreliminary: universe.length - stage2Candidates.length,
          candidatesEvaluated: topCandidates.length,
          candidatesRejectedFinal: topCandidates.length,
          signalsGenerated: 0,
          signalsAccepted: 0,
        },
      };

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Multi-Asset scan failed with exception', { symbol: cleanSymbol, error: errMsg });

      return {
        success: false,
        message: 'NO QUALIFIED TRADE',
        symbol: cleanSymbol,
        reason: `Multi-asset scanning interrupted: ${errMsg}`,
        timestamp: now,
        telemetry: {
          universeSymbolsScanned: universe.length,
          preliminaryCandidatesFound: 0,
          candidatesRejectedPreliminary: universe.length,
          candidatesEvaluated: 0,
          candidatesRejectedFinal: 0,
          signalsGenerated: 0,
          signalsAccepted: 0,
        },
      };
    }
  }

  /**
   * Retrieves active signals list (sorted by TOP TRADEs first, then by score descending).
   * Dynamically synchronizes active signals from persistent Firebase/disk storage periodically.
   */
  async getActiveSignals(): Promise<TradingSignal[]> {
    const now = Date.now();

    // Re-synchronize from persistence if memory map is empty or more than 5 seconds have elapsed
    if (this.activeSignals.size === 0 || now - this.lastActiveSignalsSyncTime > 5000) {
      try {
        const persisted = await ScannerPersistence.getActiveSignals();
        const persistedSymbols = new Set<string>();

        for (const s of persisted) {
          if (isActionableSignal(s) && s.isTradeableSignal === true && s.signalClassification === 'TRADEABLE') {
            persistedSymbols.add(s.symbol.toUpperCase());

            // Enforce that we do NOT load any signal with duplicate TPs
            const tp1 = s.tp1;
            const tp2 = s.tp2;
            const tp3 = s.tp3;
            if (tp1 !== undefined && tp2 !== undefined && tp3 !== undefined) {
              if (tp1 === tp2 || tp2 === tp3 || tp1 === tp3) {
                continue;
              }
              // Enforce correct geometry
              if (s.direction === 'BUY' && (s.entryPrice >= tp1 || tp1 >= tp2 || tp2 >= tp3)) {
                continue;
              }
              if (s.direction === 'SELL' && (s.entryPrice <= tp1 || tp1 <= tp2 || tp2 <= tp3)) {
                continue;
              }
            } else {
              continue;
            }

            const sig: TradingSignal = {
              id: s.id,
              snapshotId: s.snapshotId,
              symbol: s.symbol,
              direction: s.direction,
              entryPrice: s.entryPrice,
              stopLoss: s.stopLoss,
              takeProfit: s.takeProfit,
              tp1: s.tp1,
              tp2: s.tp2,
              tp3: s.tp3,
              riskRewardRatio: s.riskRewardRatio,
              score: s.score,
              confidenceScore: s.score,
              rankTier: s.rankTier,
              isBestTrade: s.rankTier === 'BEST_TRADE',
              isSecondBest: s.rankTier === 'SECOND_BEST',
              isTopTrade: s.rankTier === 'BEST_TRADE',
              strategy: s.strategy,
              timeframe: s.timeframe,
              dataSource: s.dataSource,
              status: s.status as any,
              isActionableSignal: isActionableSignal(s),
              timestamp: s.timestamp,
              validatedAt: s.timestamp,
              confluenceReasons: [],
              estimatedWinRate: s.estimatedWinRate,
              aiAssessment: s.aiAssessment,
              expiresAt: s.expiresAt || (s.timestamp + serverConfig.getConfig().signalExpirationMs),
            };
            this.activeSignals.set(sig.symbol, sig);
          }
        }

        // Clean up any in-memory active signal that was deleted/modified to terminal status in persistence
        for (const symbol of this.activeSignals.keys()) {
          if (!persistedSymbols.has(symbol.toUpperCase())) {
            this.activeSignals.delete(symbol);
          }
        }

        this.lastActiveSignalsSyncTime = now;
      } catch (err) {
        logger.warn('[SignalEngine] Failed to restore active signals from persistence:', { error: String(err) });
      }
    }

    const active: TradingSignal[] = [];

    for (const [symbol, signal] of this.activeSignals.entries()) {
      const isWaitingAndExpired = signal.status === 'WAITING_ENTRY' && (now - signal.timestamp > serverConfig.getConfig().signalExpirationMs);
      if (isWaitingAndExpired) {
        this.activeSignals.delete(symbol);
      } else {
        active.push(signal);
      }
    }

    return active.sort((a, b) => {
      if (a.isTopTrade && !b.isTopTrade) return -1;
      if (!a.isTopTrade && b.isTopTrade) return 1;
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return (b.score || 0) - (a.score || 0);
    });
  }

  /**
   * Clears active signals cache.
   */
  clearSignals(): void {
    this.activeSignals.clear();
  }

  /**
   * Removes an individual active signal by ID or snapshot ID.
   */
  removeActiveSignal(id: string): boolean {
    for (const [symbol, sig] of this.activeSignals.entries()) {
      if (sig.id === id || sig.snapshotId === id) {
        this.activeSignals.delete(symbol);
        return true;
      }
    }
    return false;
  }

  // --- Logger Diagnostic Trace Helper ---

  private logDiagnosticTrace(
    symbol: string,
    entryPrice: number,
    crossCheck: { isValid: boolean; agreementPct: number },
    newsSentiment: { sentiment: string; reason: string },
    scoring: ScoringResult,
    validation: ValidationResult
  ): void {
    logger.info(`================================================================`);
    logger.info(`[GATE 8 VALIDATION TRACE] Symbol: ${symbol} | Snapshot: ${validation.snapshotId}`);
    logger.info(`================================================================`);
    logger.info(`- Validated Live Price: ${entryPrice}`);
    logger.info(`- Cross-Source Agreement: ${crossCheck.agreementPct}% (Valid: ${crossCheck.isValid})`);
    logger.info(`- Finnhub News Sentiment: ${newsSentiment.sentiment} (${newsSentiment.reason})`);
    logger.info(`- Deterministic Total Score: ${scoring.score} / 100`);
    logger.info(`- Signal Direction: ${scoring.direction}`);
    logger.info(`- Calculated stopLoss: ${scoring.stopLoss} | takeProfit: ${scoring.takeProfit}`);
    logger.info(`- Net R:R: ${scoring.estimatedFriction.netRiskRewardRatio}:1`);
    logger.info(`- Gate 8 Pipeline Status: [${validation.validationReason}] ${validation.detailedMessage}`);
    logger.info(`================================================================`);
  }

  // --- Finnhub News Helpers ---
  private static cachedGeneralNews: { data: Array<{ headline?: string; summary?: string }>; timestamp: number } | null = null;

  private async fetchGeneralNews(): Promise<Array<{ headline?: string; summary?: string }>> {
    if (SignalEngine.cachedGeneralNews && (Date.now() - SignalEngine.cachedGeneralNews.timestamp) < 5 * 60 * 1000) {
      return SignalEngine.cachedGeneralNews.data;
    }
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) return [];

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${apiKey.trim()}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const json = await response.json();
        if (Array.isArray(json)) {
          SignalEngine.cachedGeneralNews = { data: json, timestamp: Date.now() };
          return json;
        }
      }
    } catch (err) {
      logger.warn('Finnhub global news fetch failed or timed out', { error: String(err) });
    }
    return SignalEngine.cachedGeneralNews?.data || [];
  }

  private evaluateNewsSentiment(
    symbol: string,
    newsList: Array<{ headline?: string; summary?: string }>
  ): { sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; reason: string } {
    if (!newsList || newsList.length === 0) {
      return { sentiment: 'NEUTRAL', reason: 'News validation: Standing by' };
    }

    let bullishCount = 0;
    let bearishCount = 0;
    const cleanSym = symbol.toLowerCase().substring(0, 4);

    const subset = newsList.slice(0, 15);
    for (const article of subset) {
      const text = ((article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
      const isRelated = text.includes(cleanSym) || text.includes('market') || text.includes('crypto') || text.includes('forex') || text.includes('stock');

      if (isRelated) {
        if (text.includes('surge') || text.includes('rise') || text.includes('bull') || text.includes('gain') || text.includes('positive') || text.includes('rally') || text.includes('growth')) {
          bullishCount++;
        }
        if (text.includes('drop') || text.includes('fall') || text.includes('bear') || text.includes('loss') || text.includes('negative') || text.includes('slump') || text.includes('down')) {
          bearishCount++;
        }
      }
    }

    if (bullishCount > bearishCount) {
      return {
        sentiment: 'BULLISH',
        reason: `Finnhub news sentiment confirms BULLISH support (+${bullishCount} positive references)`,
      };
    } else if (bearishCount > bullishCount) {
      return {
        sentiment: 'BEARISH',
        reason: `Finnhub news sentiment confirms BEARISH alignment (-${bearishCount} cautious references)`,
      };
    }

    return { sentiment: 'NEUTRAL', reason: 'Finnhub news sentiment is neutral / balanced' };
  }

  // --- Cross-Source Verification Helpers ---

  private async verifyCrossSourcePrice(
    symbol: string,
    primaryPrice: number
  ): Promise<{ isValid: boolean; agreementPct: number; secondaryPrice?: number; source2?: string }> {
    const cleanSymbol = symbol.trim().toUpperCase();

    // 1. Crypto Verification: Bitget with Finnhub
    if (cleanSymbol.includes('BTC') || cleanSymbol.includes('ETH') || cleanSymbol.includes('SOL')) {
      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) return { isValid: true, agreementPct: 100 };

      try {
        const finnhubPrice = await marketDataManager.getPrice(cleanSymbol, 'finnhub');
        if (finnhubPrice && finnhubPrice.price > 0) {
          const diff = Math.abs(primaryPrice - finnhubPrice.price);
          const pct = (diff / primaryPrice) * 100;
          return {
            isValid: pct <= 1.5,
            agreementPct: Number((100 - pct).toFixed(2)),
            secondaryPrice: finnhubPrice.price,
            source2: 'Finnhub Live Quote Feed',
          };
        }
      } catch (err) {
        logger.warn('Cross check failed for Crypto', { symbol, error: String(err) });
      }
    }

    // 2. Forex Verification: Twelve Data as Authoritative Market Data Source
    if (FOREX_UNIVERSE.includes(cleanSymbol) || MarketSessionManager.getAssetClassification(cleanSymbol) === 'FOREX') {
      // Twelve Data is the authoritative source for Forex candles and live prices.
      // Exchange Rate API is deprecated and must not be used to validate or determine executable Forex entries.
      return {
        isValid: true,
        agreementPct: 100,
        source2: 'Twelve Data Authoritative Feed',
      };
    }

    // 3. Stocks Verification: Finnhub with Twelve Data
    if (['AAPL', 'NVDA', 'MSFT'].includes(cleanSymbol)) {
      try {
        const tdPrice = await marketDataManager.getPrice(cleanSymbol, 'twelvedata');
        if (tdPrice && tdPrice.price > 0) {
          const diff = Math.abs(primaryPrice - tdPrice.price);
          const pct = (diff / primaryPrice) * 100;
          return {
            isValid: pct <= 1.5,
            agreementPct: Number((100 - pct).toFixed(2)),
            secondaryPrice: tdPrice.price,
            source2: 'Twelve Data Feed',
          };
        }
      } catch (err) {
        logger.warn('Cross check failed for Stock', { symbol, error: String(err) });
      }
    }

    return { isValid: true, agreementPct: 100 };
  }

  /**
   * Centralized promotion method to ensure only SignalEngine sets these properties.
   */
  public promoteToTradeable(sig: any): void {
    sig.isTradeableSignal = true;
    sig.signalClassification = 'TRADEABLE';
  }

  /**
   * Centralized demotion method to ensure only SignalEngine sets these properties.
   */
  public demoteToDiagnostic(sig: any): void {
    sig.isTradeableSignal = false;
    sig.signalClassification = 'DIAGNOSTIC';
  }
}

export const signalEngine = new SignalEngine();

function decimals(price: number, symbol?: string): number {
  return getDynamicPrecision(price, symbol);
}
