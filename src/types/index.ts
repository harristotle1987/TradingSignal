/**
 * Shared Type Definitions for Trading Signal System (Gate 1 Foundation)
 */

export type NavigationTab = 'SIGNALS' | 'SETTINGS';

export interface HealthResponse {
  status: string;
  service: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  aiProvider: {
    provider: string;
    configured: boolean;
    status: string;
  };
  system: {
    signalEngineStatus: string;
    activeSignalsCount: number;
    marketDataConnected: boolean;
  };
}

export interface ProviderInfo {
  name: string;
  configured: boolean;
  type: string;
  security: string;
}

export interface ConfigStatusResponse {
  success: boolean;
  timestamp: string;
  environment: string;
  providers: {
    nvidia: ProviderInfo;
    bitget: ProviderInfo;
    finnhub: ProviderInfo;
    twelvedata: ProviderInfo;
  };
  gateInfo: {
    currentGate: string;
    signalsEnabled: boolean;
    marketFeedsActive: boolean;
    reason: string;
  };
}

export interface PipelineModuleStatus {
  id: string;
  name: string;
  category: 'MARKET_DATA' | 'AI_MODEL' | 'CONFLUENCE_ENGINE' | 'VALIDATOR';
  status: 'IDLE' | 'CONFIGURED' | 'UNCONFIGURED' | 'STANDBY';
  description: string;
}

export type AssetType = 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN';

export type MarketDataStatus = 'OK' | 'STALE' | 'MARKET_DATA_UNAVAILABLE';

export interface NormalizedTicker {
  symbol: string;
  rawSymbol: string;
  provider: string;
  assetType: AssetType;
  bid: number | null;
  ask: number | null;
  price: number;
  timestamp: number;
  receivedAt: number;
  source: 'LIVE' | 'CACHE';
  isFresh: boolean;
  status: MarketDataStatus;
  errorMessage?: string;
}

export interface ProviderHealth {
  provider: string;
  name: string;
  configured: boolean;
  status: 'CONNECTED' | 'UNAVAILABLE' | 'NOT VERIFIED';
  latencyMs?: number;
  lastChecked?: string;
  errorMessage?: string;
}

export interface MarketStatusResponse {
  timestamp: string;
  gate: string;
  providers: Record<string, ProviderHealth>;
  overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE';
}

export interface NormalizedCandle {
  symbol: string;
  provider: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  timestamp: number;
}

export type SignalDirection = 'BUY' | 'SELL';

export type SignalValidationReason =
  | 'VALID'
  | 'STALE_DATA'
  | 'PRICE_MISMATCH'
  | 'INVALID_CANDLE'
  | 'INVALID_ENTRY'
  | 'INVALID_SL_TP'
  | 'INSUFFICIENT_CONFLUENCE'
  | 'MARKET_DATA_UNAVAILABLE';

export type RankTier = 'BEST_TRADE' | 'SECOND_BEST' | 'SUGGESTION';

export interface TradingSignal {
  id: string;
  snapshotId: string;
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  timeframe: string;
  strategy: string;
  confluenceReasons: string[];
  confidenceScore: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  riskRewardRatio: number;
  timestamp: number;
  validatedAt: number;
  dataSource: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REJECTED';
  aiAssessment?: string;
  rejectionReason?: string;
  validationReason?: SignalValidationReason;
  score?: number;
  isPrimary?: boolean;
  isTopTrade?: boolean;
  isBestTrade?: boolean;
  isSecondBest?: boolean;
  isSuggestion?: boolean;
  rankTier?: RankTier;
  estimatedWinRate?: number;
  isAiValidated?: boolean;
  targetDistance?: number;
  stopDistance?: number;
  suggestedRiskAmount?: number; // Hypothetical analysis only
  suggestedPositionSize?: number; // Hypothetical analysis only
  pipPointUnit?: 'PIPS' | 'POINTS';
  estimatedFriction?: {
    spreadPipsOrPoints: number;
    feeBufferPct: number;
    netRiskRewardRatio: number;
  };
  expiresAt?: number;
}

export interface SignalGenerationResponse {
  success: boolean;
  message: string;
  symbol: string;
  marketPrice?: number;
  signal?: TradingSignal;
  signals?: TradingSignal[];
  bestTrade?: TradingSignal;
  secondBest?: TradingSignal;
  suggestions?: TradingSignal[];
  reason?: string;
  timestamp: number;
}

export interface SignalsListResponse {
  success: boolean;
  signals: TradingSignal[];
  activeCount: number;
  timestamp: number;
}

export type SignalLogStatus = 
  | 'CANDIDATE' 
  | 'CONFIRMED' 
  | 'ACTIVE' 
  | 'TP1_REACHED' 
  | 'TP2_REACHED' 
  | 'TP3_REACHED' 
  | 'STOPPED' 
  | 'EXPIRED' 
  | 'INVALIDATED' 
  | 'CLOSED' 
  | 'AMBIGUOUS';

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
  riskRewardRatio: number;
  score: number;
  confidenceScore: number;
  strategy: string;
  marketRegime: string;
  status: SignalLogStatus;
  snapshotId: string;
  confluenceReasons?: string[];
  timeframe?: string;
  aiAssessment?: string;
  isTopTrade?: boolean;
  isBestTrade?: boolean;
  updatedAt?: number;
}

export interface SignalHistoryItem {
  id: string;
  snapshotId: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'NO_TRADE';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  riskRewardRatio?: number;
  score?: number;
  confidenceScore?: number;
  isTopTrade?: boolean;
  isBestTrade?: boolean;
  isSecondBest?: boolean;
  isSuggestion?: boolean;
  rankTier?: RankTier;
  outcomeType: 'BEST_TRADE' | 'SECOND_BEST' | 'SUGGESTION' | 'TOP_TRADE' | 'VALIDATED' | 'NO_TRADE_OPPORTUNITY' | 'REJECTED';
  strategy?: string;
  timeframe?: string;
  dataSource?: string;
  reason?: string;
  timestamp: number;
  marketType?: 'Crypto' | 'Forex' | 'Stocks';
  marketRegime?: string;
  signalStatus?: SignalLogStatus;
  confluenceReasons?: string[];
  aiAssessment?: string;
  estimatedWinRate?: number;
  isAiValidated?: boolean;
  stopDistance?: number;
  pipPointUnit?: 'PIPS' | 'POINTS';
  estimatedFriction?: {
    spreadPipsOrPoints?: number;
    spreadPlusSlippage?: string;
    frictionToProfitPct?: number;
    feeBufferPct?: number;
    netRiskRewardRatio?: number;
  };
}

export interface MetricSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRatePct: number;
  rollingWinRatePct: number;
  profitFactor: number;
  totalRealizedR: number;
  avgR: number;
  expectancyR: number;
  maxDrawdownR: number;
  maxLosingStreak: number;
  currentStreak: number;
}

export interface TradeOutcomeRecord {
  signalId: string;
  symbol: string;
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCKS';
  direction: 'BUY' | 'SELL';
  strategyId: string;
  strategyName: string;
  marketRegime: string;
  timeframe: string;
  confidenceScore?: number;
  confidenceRange?: '70-79' | '80-89' | '90-100';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  plannedRR: number;
  outcomeStatus: 'TP_HIT' | 'SL_HIT' | 'EXPIRED' | 'INVALIDATED';
  realizedRR: number;
  isWin: boolean;
  timestamp: number;
  resolvedAt: number;
  durationMs: number;
}

export interface StrategyPerformanceState {
  version: number;
  lastUpdated: number;
  disclaimer: string;
  overall: MetricSummary;
  byStrategy: Record<string, MetricSummary>;
  byAsset: Record<string, MetricSummary>;
  byAssetClass: Record<string, MetricSummary>;
  byTimeframe: Record<string, MetricSummary>;
  byRegime: Record<string, MetricSummary>;
  byConfidenceRange: Record<string, MetricSummary>;
  recentTrades: TradeOutcomeRecord[];
}

export interface PerformanceMetricsResponse {
  success: boolean;
  performance: StrategyPerformanceState;
  disclaimer: string;
  timestamp: number;
}


