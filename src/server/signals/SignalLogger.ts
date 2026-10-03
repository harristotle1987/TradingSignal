/**
 * Dedicated Signal Log Persistence & Analysis Engine
 *
 * Implements a strict, dedicated SIGNAL LOG separate from general application/system logs.
 *
 * Every recorded signal entry contains:
 * - Timestamp
 * - Asset / Symbol
 * - Market Type: Crypto / Forex / Stocks
 * - Provider Used
 * - Direction: BUY / SELL
 * - Entry Price
 * - Stop Loss
 * - Take Profit
 * - Risk-to-Reward Ratio (R:R)
 * - Deterministic Score
 * - Confidence Score
 * - Strategy / Confluence Used
 * - Market Regime (TREND, RANGE, BREAKOUT, HIGH-VOLATILITY, LOW-VOLATILITY)
 * - Signal Status: ACTIVE / TP HIT / SL HIT / EXPIRED / INVALIDATED
 * - Snapshot ID
 *
 * Durability:
 * - Persisted synchronously to local `signal_logs.json`
 * - Persisted asynchronously to Firestore collection `signal_logs`
 * - Restored seamlessly across container / Vercel restarts
 */

import * as fs from 'fs';
import * as path from 'path';
import { TradingSignal } from '../../types/index.js';
import { serverConfig } from '../config.js';
import { queryNeon, getNeonPool } from '../infrastructure/neon/db.js';
import { logger } from '../logger.js';
import { Gate35SignalFunnelAnalytics } from './Gate35SignalFunnelAnalytics.js';
import { ScannerPersistence, PersistedSentSignal } from './ScannerPersistence.js';

export type SignalLogStatus = 'WAITING_ENTRY' | 'ENTRY_CONFIRMED' | 'ACTIVE' | 'TP HIT' | 'SL HIT' | 'EXPIRED' | 'INVALIDATED' | 'TP1 HIT' | 'TP2 HIT' | 'TP3 HIT' | 'AMBIGUOUS';

export interface SignalLogRecord {
  id: string;
  timestamp: number;
  symbol: string;
  marketType: 'Crypto' | 'Forex' | 'Stocks';
  provider: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tp1Rr?: number;
  tp2Rr?: number;
  tp3Rr?: number;
  riskRewardRatio: number;
  score: number;
  confidenceScore: number;
  targetQualityScore?: number;
  strategy: string;
  marketRegime: string;
  status: SignalLogStatus;
  snapshotId: string;
  confluenceReasons?: string[];
  timeframe?: string;
  aiAssessment?: string;
  isTopTrade?: boolean;
  isBestTrade?: boolean;
  entryHitTimestamp?: string | null;
  updatedAt?: number;
  tp1Status?: 'PENDING' | 'HIT';
  tp2Status?: 'PENDING' | 'HIT';
  tp3Status?: 'PENDING' | 'HIT';
  slStatus?: 'ACTIVE' | 'HIT' | 'ACTIVE_FOR_ENTRY_ONLY';
  tp1HitAt?: string;
  tp2HitAt?: string;
  tp3HitAt?: string;
  stopLossHitAt?: string;
  tp1HitPrice?: number;
  tp2HitPrice?: number;
  tp3HitPrice?: number;
  stopLossHitPrice?: number;
  lastLifecycleCheckAt?: string;
  lastLifecycleCheckStatus?: string;
  lastLifecycleCheckPrice?: number;
  lastLifecycleCheckSource?: string;
  displayPrice?: number;
  expiresAt?: number;
  isTradeableSignal?: boolean;
  signalClassification?: 'TRADEABLE' | 'WATCHING' | 'QUALIFIED_CANDIDATE' | 'CANDIDATE' | 'REJECTED' | 'FILTERED' | 'BLOCKED' | 'INVALID' | 'EXPIRED_BEFORE_ENTRY' | 'NON_TRADEABLE' | 'ANALYTICS_ONLY' | 'DIAGNOSTIC';
  provenance?: 'LIVE' | 'HISTORICAL' | 'BACKTEST' | 'SIMULATION' | 'TEST';
  isSynthetic?: boolean;
}

/**
 * Helper to determine if a record represents a legitimate LIVE production outcome/signal.
 * Strictly requires LIVE provenance and verified market data pipeline.
 * Explicitly rejects TEST, SIMULATION, BACKTEST, MOCK, SYNTHETIC, artificial 50000/49000/52000 prices,
 * and unverified market data pipelines.
 */
export function isProductionRecord(record: {
  provenance?: string;
  isSynthetic?: boolean;
  id?: string;
  signalId?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  dataSource?: string;
  provider?: string;
} | null | undefined): boolean {
  if (!record) return false;
  if (record.isSynthetic === true) return false;

  const id = record.id || record.signalId || '';
  if (
    id.startsWith('test_') ||
    id.startsWith('sim_') ||
    id.startsWith('backtest_') ||
    id.startsWith('mock_') ||
    id.startsWith('funnel_test_') ||
    id.startsWith('s1') ||
    id === 'entry_after_expiry' ||
    id === 'entry_before_expiry' ||
    id === 'after_expiry' ||
    id === 'exact_expiry'
  ) {
    return false;
  }

  const prov = (record.provenance || '').toUpperCase().trim();
  // 6. Explicitly reject: "TEST", "SIMULATION", "BACKTEST", "MOCK", "SYNTHETIC"
  if (
    prov === 'TEST' ||
    prov === 'SIMULATION' ||
    prov === 'BACKTEST' ||
    prov === 'MOCK' ||
    prov === 'SYNTHETIC'
  ) {
    return false;
  }

  // 5. Production records must have valid provenance: "LIVE"
  if (prov !== 'LIVE') {
    return false;
  }

  // 7 & 8. Reject artificial 50000, 49000, 52000 or invalid/default prices
  const entry = Number(record.entryPrice);
  const sl = Number(record.stopLoss);
  const tp = Number(record.takeProfit);

  if (isNaN(entry) || entry <= 0 || !isFinite(entry)) {
    return false;
  }

  if (entry === 50000 || sl === 49000 || tp === 52000) {
    return false;
  }

  // Reject artificial/mock data sources
  const src = ((record as any).dataSource || (record as any).provider || '').toLowerCase();
  if (
    src.includes('mock') ||
    src.includes('synthetic') ||
    src.includes('unverified') ||
    src.includes('simulation') ||
    src.includes('test') ||
    src.includes('fallback_default')
  ) {
    return false;
  }

  return true;
}

/**
 * Helper to determine if a signal log record is an EXPLICITLY TRADEABLE SIGNAL.
 * Strictly excludes internal candidates and non-tradeable statuses.
 */
export function isTradeableLogRecord(record: SignalLogRecord | undefined | null): boolean {
  if (!record) return false;

  const classification = (record.signalClassification || '').toUpperCase().trim();

  const nonTradeableClassifications = new Set([
    'WATCHING',
    'QUALIFIED_CANDIDATE',
    'CANDIDATE',
    'REJECTED',
    'FILTERED',
    'BLOCKED',
    'INVALID',
    'EXPIRED_BEFORE_ENTRY',
    'NON_TRADEABLE',
    'ANALYTICS_ONLY',
    'DIAGNOSTIC',
    'LEGACY UNKNOWN',
    'LEGACY_UNKNOWN',
    'UNKNOWN',
  ]);

  if (classification && nonTradeableClassifications.has(classification)) {
    return false;
  }

  return record.isTradeableSignal === true && classification === 'TRADEABLE';
}

const LOCAL_SIGNAL_LOG_PATH = path.join(process.cwd(), 'signal_logs.json');

export class SignalLogger {
  private static logs: Map<string, SignalLogRecord> = new Map();
  private static isInitialized = false;
  private static lastNeonSync = 0;

  /**
   * Helper to detect Market Type from Symbol structure
   */
  public static detectMarketType(symbol: string): 'Crypto' | 'Forex' | 'Stocks' {
    const s = symbol.toUpperCase();
    if (
      s.includes('USDT') ||
      s.includes('BTC') ||
      s.includes('ETH') ||
      s.includes('SOL') ||
      s.includes('XRP') ||
      s.includes('BNB') ||
      s.includes('ADA') ||
      s.includes('AVAX') ||
      s.includes('LINK') ||
      s.includes('DOGE')
    ) {
      return 'Crypto';
    }
    if (
      s.includes('EUR') ||
      s.includes('GBP') ||
      s.includes('JPY') ||
      s.includes('AUD') ||
      s.includes('CAD') ||
      s.includes('CHF') ||
      s.includes('NZD') ||
      (s.length === 6 && s.endsWith('USD'))
    ) {
      return 'Forex';
    }
    return 'Stocks';
  }

  /**
   * Re-synchronizes in-memory and local disk cache with master Neon PostgreSQL logs collection.
   */
  public static async syncFromNeon(): Promise<void> {
    if (!getNeonPool()) return;

    try {
      const rows = await queryNeon<{ payload_json: SignalLogRecord }>(`SELECT payload_json FROM signals`);
      const dbIds = new Set<string>();

      for (const r of rows) {
        const data = r.payload_json;
        if (data && data.id) {
          dbIds.add(data.id);
          const existing = this.logs.get(data.id);
          if (!existing || (data.updatedAt || data.timestamp) >= (existing.updatedAt || existing.timestamp)) {
            this.logs.set(data.id, data);
          }
        }
      }

      this.lastNeonSync = Date.now();
      if (dbIds.size > 0) {
        this.flushToDisk();
      }
    } catch (err) {
      logger.debug('[SignalLogger] Neon synchronization deferred:', { reason: String(err) });
    }
  }

  /**
   * Initializes signal log state from local disk and Firestore
   */
  public static async init(): Promise<void> {
    if (this.isInitialized) return;

    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      // 1. Read from local disk file in development/testing only
      try {
        if (fs.existsSync(LOCAL_SIGNAL_LOG_PATH)) {
          const raw = fs.readFileSync(LOCAL_SIGNAL_LOG_PATH, 'utf-8');
          const parsed: SignalLogRecord[] = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && item.id) {
                this.logs.set(item.id, item);
              }
            }
            logger.info(`[SignalLogger] Loaded ${this.logs.size} signal records from local storage.`);
          }
        }
      } catch (err) {
        logger.warn('[SignalLogger] Could not read local signal log file:', { error: String(err) });
      }
    }

    // 2. Sync from Neon if available
    await this.syncFromNeon();

    this.isInitialized = true;
  }

  /**
   * Flushes in-memory signal logs to disk synchronously
   */
  private static flushToDisk(): void {
    try {
      const records = Array.from(this.logs.values()).sort((a, b) => b.timestamp - a.timestamp);
      fs.writeFileSync(LOCAL_SIGNAL_LOG_PATH, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[SignalLogger] Failed to write signal logs to disk:', { error: String(err) });
    }
  }

  /**
   * Persists a record into Neon PostgreSQL asynchronously
   */
  private static syncToNeon(record: SignalLogRecord): void {
    if (!getNeonPool()) return;

    const cleanRecord = JSON.parse(JSON.stringify(record));
    queryNeon(
      `INSERT INTO signals (id, snapshot_id, symbol, direction, entry_price, stop_loss, take_profit, risk_reward_ratio, score, rank_tier, strategy, timeframe, data_source, status, timestamp, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         score = EXCLUDED.score,
         payload_json = EXCLUDED.payload_json`,
      [
        record.id,
        record.snapshotId || record.id,
        record.symbol,
        record.direction,
        record.entryPrice || 0,
        record.stopLoss || 0,
        record.takeProfit || 0,
        record.riskRewardRatio || 0,
        record.score || 0,
        (record as any).rankTier || 'QUALIFIED',
        record.strategy || 'NVIDIA_ENHANCED',
        record.timeframe || '1h',
        record.provider || 'REALTIME',
        record.status || 'ACTIVE',
        record.timestamp || Date.now(),
        JSON.stringify(cleanRecord),
      ]
    ).catch((err) => {
      logger.debug(`[SignalLogger] Neon sync deferred for signal ${record.id}`, { error: String(err) });
    });
  }

  /**
   * Records a newly generated trading signal into the dedicated Signal Log with strict persistence checks.
   */
  public static async logSignal(
    signal: TradingSignal,
    marketRegime = 'TREND',
    overrideStatus?: SignalLogStatus
  ): Promise<{ success: boolean; status: 'TRADEABLE_RECORD_PERSISTED' | 'PERSISTENCE_FAILED'; record?: SignalLogRecord; error?: string }> {
    await this.init();

    const id = signal.id || signal.snapshotId || `${signal.symbol}_${signal.timestamp}`;
    const snapshotId = signal.snapshotId || id;
    const marketType = this.detectMarketType(signal.symbol);
    const provider = signal.dataSource || (marketType === 'Crypto' ? 'Bitget' : 'Twelve Data');
    const strategy =
      signal.strategy ||
      (signal.confluenceReasons && signal.confluenceReasons.length > 0
        ? signal.confluenceReasons.join('; ')
        : 'Multi-Strategy Confluence');

    const status: SignalLogStatus =
      overrideStatus ||
      (signal.status === 'ACTIVE'
        ? 'ACTIVE'
        : signal.status === 'WAITING_ENTRY'
        ? 'WAITING_ENTRY'
        : (signal.status as SignalLogStatus) || 'WAITING_ENTRY');

    if (signal.isTradeableSignal !== true || signal.signalClassification !== 'TRADEABLE') {
      const directionStr = (signal.direction === 'BUY' || signal.direction === 'SELL') 
        ? signal.direction 
        : 'NEUTRAL';

      const stageMap: Record<string, any> = {
        'CANDIDATE': 'CANDIDATE',
        'WATCHING': 'GATE_4',
        'QUALIFIED_CANDIDATE': 'GATE_8',
        'REJECTED': 'GATE_3',
        'FILTERED': 'GATE_5',
        'BLOCKED': 'GATE_7',
        'DIAGNOSTIC': 'GATE_9',
      };
      const rawClassification = signal.signalClassification || 'CANDIDATE';
      const stage = stageMap[rawClassification] || 'CANDIDATE';

      Gate35SignalFunnelAnalytics.recordCandidate({
        id,
        symbol: signal.symbol,
        direction: directionStr,
        stage: stage,
        score: signal.score || 0,
        regime: signal.marketRegime || 'UNKNOWN',
        strategy: signal.strategy || 'Unknown',
        rejectionReason: signal.rejectionReason || `Signal classification: ${signal.signalClassification}`,
        rejectionCode: signal.rejectionReason ? undefined : `CLASSIFICATION_${rawClassification}`,
        grossRR: signal.riskRewardRatio,
        netRR: (signal as any).netRR,
        adverseNetRR: (signal as any).adverseNetRR,
        estimatedWinRate: (signal as any).estimatedWinRate || signal.confidenceScore,
        timeframeAlignmentRatio: (signal as any).timeframeAlignmentRatio,
        strategyAgreementRatio: (signal as any).strategyAgreementRatio,
      });

      return {
        success: false,
        status: 'PERSISTENCE_FAILED',
        error: `Signal classification ${signal.signalClassification} not allowed in SignalLogger.`,
      };
    }

    const provRaw = (signal.provenance || '').toUpperCase().trim();
    let provenance: 'LIVE' | 'HISTORICAL' | 'BACKTEST' | 'SIMULATION' | 'TEST';
    if (provRaw === 'LIVE' || provRaw === 'HISTORICAL' || provRaw === 'BACKTEST' || provRaw === 'SIMULATION' || provRaw === 'TEST') {
      provenance = provRaw as any;
    } else if (process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true' || signal.isSynthetic || id.startsWith('test_') || id.startsWith('sim_') || id.startsWith('backtest_')) {
      provenance = 'TEST';
    } else {
      provenance = 'LIVE';
    }

    const record: SignalLogRecord = {
      id,
      snapshotId,
      timestamp: signal.validatedAt || signal.timestamp || Date.now(),
      symbol: signal.symbol,
      marketType,
      provider,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      tp1Rr: signal.tp1Rr,
      tp2Rr: signal.tp2Rr,
      tp3Rr: signal.tp3Rr,
      riskRewardRatio: Number(signal.riskRewardRatio?.toFixed(2) || 2.0),
      score: signal.score || 0,
      confidenceScore: signal.confidenceScore || 0,
      targetQualityScore: signal.targetQualityScore,
      strategy,
      marketRegime,
      status,
      confluenceReasons: signal.confluenceReasons,
      timeframe: signal.timeframe || '1h',
      aiAssessment: signal.aiAssessment,
      isTopTrade: signal.isTopTrade || signal.rankTier === 'BEST_TRADE',
      isBestTrade: signal.isBestTrade || signal.rankTier === 'BEST_TRADE',
      entryHitTimestamp: signal.entryHitTimestamp ?? null,
      updatedAt: Date.now(),
      isTradeableSignal: signal.isTradeableSignal === true,
      signalClassification: signal.signalClassification,
      provenance,
      isSynthetic: Boolean(signal.isSynthetic),
    };

    const isProd = serverConfig.getConfig().nodeEnv === 'production';
    if (isProd || provenance === 'LIVE') {
      if (!isProductionRecord(record as any)) {
        const rejectMsg = `[SignalLogger] REJECTED signal ${id} (${signal.symbol}): Failed production provenance, artificial price, or unverified market data pipeline.`;
        logger.warn(rejectMsg);
        return {
          success: false,
          status: 'PERSISTENCE_FAILED',
          record,
          error: rejectMsg,
        };
      }
    }

    this.logs.set(id, record);
    this.flushToDisk();

    if (!getNeonPool()) {
      if (serverConfig.getConfig().nodeEnv === 'production') {
        const errStr = '[SignalLogger] FAIL CLOSED: DATABASE_URL required for signal log persistence in production mode.';
        logger.error(errStr);
        return {
          success: false,
          status: 'PERSISTENCE_FAILED',
          record,
          error: errStr,
        };
      }
      return {
        success: true,
        status: 'TRADEABLE_RECORD_PERSISTED',
        record,
      };
    }

    this.syncToNeon(record);
    return {
      success: true,
      status: 'TRADEABLE_RECORD_PERSISTED',
      record,
    };
  }

  /**
   * Updates the lifecycle status of an existing signal in the Signal Log.
   */
  public static async updateStatus(signalId: string, status: SignalLogStatus): Promise<boolean> {
    await this.init();

    let record = this.logs.get(signalId);

    // If not found by exact ID, search by snapshotId or symbol prefix
    if (!record) {
      for (const r of this.logs.values()) {
        if (r.snapshotId === signalId || r.id.startsWith(signalId)) {
          record = r;
          break;
        }
      }
    }

    if (!record) {
      logger.warn(`[SignalLogger] Cannot update status: signal ${signalId} not found in Signal Log.`);
      return false;
    }

    record.status = status;
    record.updatedAt = Date.now();

    this.logs.set(record.id, record);
    this.flushToDisk();
    this.syncToNeon(record);

    logger.info(`[SignalLogger] UPDATED SIGNAL LOG STATUS: ${record.symbol} -> ${status}`);
    return true;
  }

  /**
   * Updates the take-profit targets and risk-reward ratio of an existing signal in the Signal Log.
   */
  public static async updateTps(
    signalId: string,
    tp1: number,
    tp2: number,
    tp3: number,
    takeProfit: number,
    riskRewardRatio: number
  ): Promise<boolean> {
    await this.init();

    let record = this.logs.get(signalId);

    // Search by snapshotId or exact id if not found by key
    if (!record) {
      for (const r of this.logs.values()) {
        if (r.snapshotId === signalId || r.id === signalId || r.id.startsWith(signalId)) {
          record = r;
          break;
        }
      }
    }

    if (!record) {
      logger.warn(`[SignalLogger] Cannot update TPs: signal ${signalId} not found in Signal Log.`);
      return false;
    }

    record.tp1 = tp1;
    record.tp2 = tp2;
    record.tp3 = tp3;
    record.takeProfit = takeProfit;
    record.riskRewardRatio = riskRewardRatio;
    record.updatedAt = Date.now();

    this.logs.set(record.id, record);
    this.flushToDisk();
    this.syncToNeon(record);

    logger.info(`[SignalLogger] UPDATED SIGNAL LOG TPs for ${record.symbol}: T1: ${tp1}, T2: ${tp2}, T3: ${tp3}`);
    return true;
  }

  /**
   * Retrieves dedicated Signal Log records (sorted newest first).
   * Strictly filters to explicitly tradeable signals only.
   */
  public static async getSignalLogs(
    limit = 100,
    productionOnly = true
  ): Promise<SignalLogRecord[]> {
    const isProd = serverConfig.getConfig().nodeEnv === 'production';
    if (isProd && !getNeonPool()) {
      logger.warn('[SignalLogger] FAIL SAFELY: Neon database is unavailable in production. Returning empty list instead of local fallback.');
      return [];
    }

    await this.init();

    const now = Date.now();
    if (now - this.lastNeonSync > 5000) {
      await this.syncFromNeon();
    }

    // Load latest sent signals from ScannerPersistence to merge real-time lifecycle check metadata
    let sentMap = new Map<string, PersistedSentSignal>();
    try {
      const sentSignals = await ScannerPersistence.getSentSignals();
      for (const s of sentSignals) {
        if (s.id) sentMap.set(s.id, s);
        if (s.snapshotId) sentMap.set(s.snapshotId, s);
      }
    } catch (err) {
      logger.debug('[SignalLogger] Could not load sent signals for lifecycle enrichment:', err);
    }

    const sorted = Array.from(this.logs.values())
      .filter((r) => isTradeableLogRecord(r) && (!productionOnly || isProductionRecord(r)))
      .map((r) => {
        const sent = sentMap.get(r.id) || sentMap.get(r.snapshotId);
        if (sent) {
          return {
            ...r,
            status: (sent.status as any) || r.status,
            tp1Status: sent.tp1Status,
            tp2Status: sent.tp2Status,
            tp3Status: sent.tp3Status,
            slStatus: sent.slStatus,
            tp1HitAt: sent.tp1HitAt,
            tp2HitAt: sent.tp2HitAt,
            tp3HitAt: sent.tp3HitAt,
            stopLossHitAt: sent.stopLossHitAt,
            tp1HitPrice: sent.tp1HitPrice,
            tp2HitPrice: sent.tp2HitPrice,
            tp3HitPrice: sent.tp3HitPrice,
            stopLossHitPrice: sent.stopLossHitPrice,
            entryHitTimestamp: sent.entryHitTimestamp,
            lastLifecycleCheckAt: sent.lastLifecycleCheckAt,
            lastLifecycleCheckStatus: sent.lastLifecycleCheckStatus,
            lastLifecycleCheckPrice: sent.lastLifecycleCheckPrice,
            lastLifecycleCheckSource: sent.lastLifecycleCheckSource,
            displayPrice: sent.displayPrice,
            expiresAt: sent.expiresAt,
          };
        }
        return r;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
    return sorted.slice(0, limit);
  }

  /**
   * Retrieves all signal log records including internal candidates for internal analytics.
   */
  public static async getAllSignalLogs(limit = 100): Promise<SignalLogRecord[]> {
    await this.init();
    const tradeables = await this.getSignalLogs(limit);
    const candidates = Gate35SignalFunnelAnalytics.getRecords(limit)
      .filter((r) => r.stage !== 'FINAL_SIGNAL')
      .map((r) => ({
        id: r.id,
        snapshotId: r.id,
        timestamp: r.timestamp,
        symbol: r.symbol,
        marketType: this.detectMarketType(r.symbol),
        provider: r.assetClass === 'Crypto' ? 'Bitget' : 'Twelve Data',
        direction: (r.direction === 'BUY' || r.direction === 'SELL') ? r.direction : 'BUY',
        entryPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        riskRewardRatio: r.netRR || 2.0,
        score: r.score,
        confidenceScore: r.estimatedWinRate || 0,
        strategy: r.strategy,
        marketRegime: r.regime,
        status: 'WAITING_ENTRY' as any,
        isTradeableSignal: false,
        signalClassification: (r.stage === 'GATE_4' ? 'WATCHING' : r.stage === 'GATE_8' ? 'QUALIFIED_CANDIDATE' : r.stage === 'GATE_3' ? 'REJECTED' : 'FILTERED') as any,
      }));
    const combined = [...tradeables, ...candidates]
      .sort((a, b) => b.timestamp - a.timestamp);
    return combined.slice(0, limit);
  }

  /**
   * Retrieves the most recent signal for a symbol from the signal log.
   * By default, tradeableOnly is true so tradeability/cooldown/duplicate logic
   * only evaluates explicitly tradeable signals.
   */
  public static getLastSignalForSymbol(
    symbol: string,
    options?: { tradeableOnly?: boolean }
  ): SignalLogRecord | undefined {
    const sym = symbol.toUpperCase();
    const tradeableOnly = options?.tradeableOnly !== false;
    const records = Array.from(this.logs.values())
      .filter((r) => r.symbol === sym && (!tradeableOnly || isTradeableLogRecord(r)))
      .sort((a, b) => b.timestamp - a.timestamp);
    return records[0];
  }

  /**
   * Explicitly retrieves the last tradeable signal for a symbol.
   */
  public static getLastTradeableSignalForSymbol(symbol: string): SignalLogRecord | undefined {
    return this.getLastSignalForSymbol(symbol, { tradeableOnly: true });
  }

  /**
   * Retrieves the last internal candidate (non-tradeable) signal record for internal analytics.
   */
  public static getLastCandidateForSymbol(symbol: string): SignalLogRecord | undefined {
    const sym = symbol.toUpperCase();
    const records = Gate35SignalFunnelAnalytics.getRecords(1000)
      .filter((r) => r.symbol === sym && r.stage !== 'FINAL_SIGNAL');
    if (records.length === 0) return undefined;
    const r = records[0];
    
    return {
      id: r.id,
      snapshotId: r.id,
      timestamp: r.timestamp,
      symbol: r.symbol,
      marketType: this.detectMarketType(r.symbol),
      provider: r.assetClass === 'Crypto' ? 'Bitget' : 'Twelve Data',
      direction: (r.direction === 'BUY' || r.direction === 'SELL') ? r.direction : 'BUY',
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      riskRewardRatio: r.netRR || 2.0,
      score: r.score,
      confidenceScore: r.estimatedWinRate || 0,
      strategy: r.strategy,
      marketRegime: r.regime,
      status: 'WAITING_ENTRY' as any,
      isTradeableSignal: false,
      signalClassification: (r.stage === 'GATE_4' ? 'WATCHING' : r.stage === 'GATE_8' ? 'QUALIFIED_CANDIDATE' : r.stage === 'GATE_3' ? 'REJECTED' : 'FILTERED') as any,
    };
  }

  /**
   * Retrieves log records for a specific symbol.
   */
  public static getLogsForSymbol(
    symbol: string,
    options?: { tradeableOnly?: boolean }
  ): SignalLogRecord[] {
    const sym = symbol.toUpperCase();
    const tradeableOnly = options?.tradeableOnly !== false;
    return Array.from(this.logs.values())
      .filter((r) => r.symbol === sym && (!tradeableOnly || isTradeableLogRecord(r)))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Deletes a single signal log record by ID from memory, disk, and Firestore.
   */
  public static async deleteLog(id: string): Promise<boolean> {
    await this.init();

    let targetKey: string | null = null;
    if (this.logs.has(id)) {
      targetKey = id;
    } else {
      for (const [key, r] of this.logs.entries()) {
        if (r.snapshotId === id || r.id === id || key.startsWith(id)) {
          targetKey = key;
          break;
        }
      }
    }

    if (targetKey && this.logs.has(targetKey)) {
      this.logs.delete(targetKey);
      this.flushToDisk();
    }

    if (getNeonPool()) {
      try {
        await queryNeon(`DELETE FROM signals WHERE id = $1 OR snapshot_id = $1`, [id]);
        if (targetKey && targetKey !== id) {
          await queryNeon(`DELETE FROM signals WHERE id = $1 OR snapshot_id = $1`, [targetKey]);
        }
      } catch (err) {
        logger.error(`[SignalLogger] Neon delete error for ${id}:`, { error: String(err) });
      }
    }

    logger.info(`[SignalLogger] DELETED INDIVIDUAL SIGNAL LOG RECORD: ${id}`);
    return true;
  }

  /**
   * Clears the signal log cache and disk file.
   */
  public static async clearLogs(): Promise<void> {
    this.logs.clear();
    this.flushToDisk();

    if (getNeonPool()) {
      try {
        await queryNeon(`DELETE FROM signals`);
      } catch (err) {
        logger.debug('[SignalLogger] Neon clear logs deferred:', { error: String(err) });
      }
    }
  }
}
