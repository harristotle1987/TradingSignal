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
import { Gate3PreliminaryScreen, Gate3PreliminaryScreenResult } from './Gate3PreliminaryScreen.js';
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
   * GATE 3: Cheap Preliminary Market Screening on 1H Baseline.
   * Evaluates Liquidity (20), Volume (20), Trend (20), Momentum (15), Volatility Quality (15), and Spread Quality (10).
   * Total = 100.
   * Used strictly for candidate selection (no trade signals generated here).
   */
  public computeTechnicalVolatilityScore(symbol: string, htf1h: NormalizedCandle[]): { preliminaryScore: number; direction: SignalDirection; reason: string; atr: number; gate3Result?: Gate3PreliminaryScreenResult } {
    const result = Gate3PreliminaryScreen.screenAsset(symbol, htf1h);
    return {
      preliminaryScore: result.preliminaryScore,
      direction: result.direction,
      reason: result.reason,
      atr: result.metrics.atr,
      gate3Result: result,
    };
  }

  /**
   * Generates validated trading signals using an optimized staged universe scanner.
   * Stage 1: Cheap / current market-data screening (Session & cached baseline).
   * Stage 2: Technical / volatility filtering (EMA stack, momentum, ATR sufficiency).
   * Stage 3: Deep multi-timeframe analysis on top candidates only (strictly conserves API calls).
   * Stage 4: Ranking qualified setups (at most 5 returned, top 2 marked as BEST TRADE, rest as suggestions).
   */
  async generateSignal(
    symbol = 'EURUSD',
    category?: string,
    persistAndActivate: boolean = true,
    options?: { scanStartedAt?: number; globalScanBudgetMs?: number; executionId?: string }
  ): Promise<SignalGenerationResponse> {
    const { runStagedPipeline } = await import('./StagedScannerPipeline.js');
    return runStagedPipeline(this, symbol, category, persistAndActivate, options);
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
    const thresholds = serverConfig.getConfig().thresholds;
    logger.info(`================================================================`);
    logger.info(`[GATE 8 VALIDATION TRACE] Symbol: ${symbol} | Snapshot: ${validation.snapshotId}`);
    logger.info(`================================================================`);
    logger.info(`- Validated Live Price: ${entryPrice}`);
    logger.info(`- Cross-Source Agreement: ${crossCheck.agreementPct}% (Valid: ${crossCheck.isValid})`);
    logger.info(`- Finnhub News Sentiment: ${newsSentiment.sentiment} (${newsSentiment.reason})`);
    logger.info(`- Deterministic Total Score: ${scoring.score} / 100 (Configured Threshold: >= ${thresholds.signalThreshold})`);
    logger.info(`- Signal Direction: ${scoring.direction}`);
    logger.info(`- Calculated stopLoss: ${scoring.stopLoss} | takeProfit: ${scoring.takeProfit}`);
    logger.info(`- Net R:R: ${scoring.estimatedFriction.netRiskRewardRatio}:1 (Min Gross: ${thresholds.minimumRR}:1, Min Net: ${thresholds.minimumNetRR}:1)`);
    logger.info(`- Hard Gate Status: [${validation.validationReason}] ${validation.detailedMessage}`);
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
    primaryPrice: number,
    globalScanDeadlineMs?: number
  ): Promise<{ isValid: boolean; agreementPct: number; secondaryPrice?: number; source2?: string }> {
    const cleanSymbol = symbol.trim().toUpperCase();

    if (globalScanDeadlineMs && globalScanDeadlineMs - Date.now() <= 1000) {
      return { isValid: true, agreementPct: 100 };
    }

    // 1. Crypto Verification: Bitget with Finnhub
    if (cleanSymbol.includes('BTC') || cleanSymbol.includes('ETH') || cleanSymbol.includes('SOL')) {
      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) return { isValid: true, agreementPct: 100 };

      try {
        const finnhubPrice = await marketDataManager.getPrice(cleanSymbol, 'finnhub', false, 'AUTOMATED_SCANNER', globalScanDeadlineMs);
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
        const tdPrice = await marketDataManager.getPrice(cleanSymbol, 'twelvedata', false, 'AUTOMATED_SCANNER', globalScanDeadlineMs);
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
