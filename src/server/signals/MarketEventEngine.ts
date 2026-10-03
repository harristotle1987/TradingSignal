/**
 * MarketEventEngine
 *
 * Isolated event-driven market & signal processing engine inspired by:
 * - QuantConnect / Lean: https://github.com/QuantConnect/Lean
 * - NautilusTrader: https://github.com/nautechsystems/nautilus_trader
 *
 * ARCHITECTURAL CORE PRINCIPLES:
 * 1. Normalized Market Events:
 *    Uniform event envelope with immutable timestamp, monotonic sequence ID,
 *    event type, symbol, and strictly typed payload (Bars, Quotes, Signals, State Transitions).
 * 2. Candle & Event Sequencing:
 *    Strict time-priority event sequencing that prevents out-of-order execution,
 *    eliminates look-ahead bias, and guarantees deterministic processing order.
 * 3. Deterministic Timestamps & Clock:
 *    Dual-mode clock ('LIVE' vs 'HISTORICAL') where simulation clock time is strictly
 *    bound to processed event timestamps with zero knowledge of future data.
 * 4. Position & Signal Lifecycle Events:
 *    Deterministic state machine for signal candidates from generation through
 *    qualification, entry trigger, TP/SL progression, and resolution.
 * 5. Consistent Historical / Live Event Processing:
 *    Identical handler signatures, pub/sub dispatcher, and business logic across
 *    live streaming market updates and historical backtest/replay runs.
 *
 * STRICT GOVERNANCE:
 * - NO BROKER EXECUTION.
 * - The application remains strictly signal-only.
 */

import { NormalizedCandle, NormalizedTicker, SignalDirection, TradingSignal } from '../../types/index.js';
import { logger } from '../logger.js';

export type MarketEventType =
  | 'BAR_OPEN'
  | 'BAR_UPDATE'
  | 'BAR_CLOSE'
  | 'QUOTE_TICK'
  | 'SIGNAL_CANDIDATE'
  | 'SIGNAL_QUALIFIED'
  | 'SIGNAL_DISQUALIFIED'
  | 'SIGNAL_ENTRY_TRIGGERED'
  | 'SIGNAL_TP_HIT'
  | 'SIGNAL_SL_HIT'
  | 'SIGNAL_EXPIRED'
  | 'SIGNAL_CANCELLED'
  | 'REGIME_SHIFT'
  | 'VOLATILITY_BURST';

export type EngineMode = 'LIVE' | 'HISTORICAL';

export interface MarketEvent<T = any> {
  id: string;
  type: MarketEventType;
  symbol: string;
  timestamp: number;        // Deterministic UNIX timestamp (ms)
  sequenceNumber: number;   // Strictly monotonic incrementing integer
  source: 'LIVE_FEED' | 'HISTORICAL_REPLAY' | 'SCANNER_PIPELINE' | 'LIFECYCLE_MONITOR' | 'SYNTHETIC';
  payload: T;
  simulatedTime?: number;
}

export interface BarEventPayload {
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface QuoteTickPayload {
  price: number;
  bid?: number;
  ask?: number;
  volume?: number;
  provider: string;
}

export type SignalLifecycleState =
  | 'CANDIDATE'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'WAITING_ENTRY'
  | 'ACTIVE_POSITION'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'SL_HIT'
  | 'EXPIRED'
  | 'CANCELLED';

export interface SignalLifecyclePayload {
  signalId: string;
  symbol: string;
  direction: SignalDirection;
  previousState?: SignalLifecycleState;
  newState: SignalLifecycleState;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  transitionReason?: string;
  milestoneDetails?: {
    tpIndex?: number;
    pctGain?: number;
    rrRealized?: number;
  };
}

export interface RegimeShiftPayload {
  symbol: string;
  previousRegime: string;
  newRegime: string;
  volatilityCondition: 'NORMAL' | 'CAUTION' | 'UNSAFE';
  confidence: number;
}

export type EventHandler<T = any> = (event: MarketEvent<T>) => void | Promise<void>;

export interface MarketEventEngineOptions {
  mode?: EngineMode;
  bufferCapacity?: number;
  strictTimeOrdering?: boolean;
}

export interface EngineTelemetry {
  mode: EngineMode;
  currentClockTime: number;
  totalEventsProcessed: number;
  lastSequenceNumber: number;
  eventsByType: Record<string, number>;
  activeSignalsMonitored: number;
  outOfOrderEventsDetected: number;
}

export class MarketEventEngine {
  private mode: EngineMode;
  private currentClockTime: number;
  private sequenceCounter: number = 0;
  private readonly bufferCapacity: number;
  private readonly strictTimeOrdering: boolean;

  // In-memory event log for deterministic replay and audit
  private eventHistory: MarketEvent[] = [];

  // Pub/Sub listener registry
  private listeners: Map<MarketEventType, Set<EventHandler>> = new Map();
  private globalListeners: Set<EventHandler> = new Set();

  // Signal lifecycle tracking state
  private signalStates: Map<string, {
    state: SignalLifecycleState;
    signalId: string;
    symbol: string;
    direction: SignalDirection;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    history: Array<{ state: SignalLifecycleState; timestamp: number; price: number; reason?: string }>;
  }> = new Map();

  // Telemetry
  private eventsByType: Record<string, number> = {};
  private outOfOrderCount: number = 0;

  constructor(options: MarketEventEngineOptions = {}) {
    this.mode = options.mode || 'LIVE';
    this.bufferCapacity = options.bufferCapacity || 5_000;
    this.strictTimeOrdering = options.strictTimeOrdering !== false;
    this.currentClockTime = this.mode === 'LIVE' ? Date.now() : 0;
  }

  // ==========================================
  // CLOCK & DETERMINISTIC TIME MANAGEMENT
  // ==========================================

  public getMode(): EngineMode {
    return this.mode;
  }

  public setMode(mode: EngineMode): void {
    this.mode = mode;
    if (mode === 'LIVE') {
      this.currentClockTime = Date.now();
    }
  }

  public getNow(): number {
    return this.mode === 'LIVE' ? Date.now() : this.currentClockTime;
  }

  public advanceClock(toTimestamp: number): void {
    if (this.mode === 'HISTORICAL') {
      if (toTimestamp < this.currentClockTime && this.strictTimeOrdering) {
        throw new Error(
          `[MarketEventEngine] Cannot advance clock backward from ${this.currentClockTime} to ${toTimestamp}`
        );
      }
      this.currentClockTime = toTimestamp;
    } else {
      this.currentClockTime = Date.now();
    }
  }

  // ==========================================
  // EVENT PUBLISHING & ORDERING KERNEL
  // ==========================================

  /**
   * Dispatches a normalized market event through the engine.
   * Enforces sequence monotonicity and deterministic timestamp updates.
   */
  public emitEvent<T>(
    type: MarketEventType,
    symbol: string,
    payload: T,
    timestamp?: number,
    source: MarketEvent['source'] = this.mode === 'LIVE' ? 'LIVE_FEED' : 'HISTORICAL_REPLAY'
  ): MarketEvent<T> {
    const eventTime = timestamp ?? this.getNow();

    // Check time sequencing
    if (this.mode === 'HISTORICAL') {
      if (eventTime < this.currentClockTime) {
        this.outOfOrderCount += 1;
        if (this.strictTimeOrdering) {
          logger.warn(
            `[MarketEventEngine] Out-of-order event rejected in strict historical mode: eventTime=${eventTime} < clockTime=${this.currentClockTime}`
          );
        }
      } else {
        this.currentClockTime = eventTime;
      }
    }

    this.sequenceCounter += 1;
    const event: MarketEvent<T> = {
      id: `evt_${eventTime}_${this.sequenceCounter}`,
      type,
      symbol: symbol.toUpperCase(),
      timestamp: eventTime,
      sequenceNumber: this.sequenceCounter,
      source,
      payload,
      simulatedTime: this.mode === 'HISTORICAL' ? this.currentClockTime : undefined,
    };

    // Store in circular history buffer
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.bufferCapacity) {
      this.eventHistory.shift();
    }

    // Telemetry tracking
    this.eventsByType[type] = (this.eventsByType[type] || 0) + 1;

    // Dispatch to typed and global subscribers
    this.dispatchEvent(event);

    return event;
  }

  private dispatchEvent<T>(event: MarketEvent<T>): void {
    const specific = this.listeners.get(event.type);
    if (specific) {
      for (const listener of specific) {
        try {
          listener(event);
        } catch (err: any) {
          logger.warn(`[MarketEventEngine] Listener failed for ${event.type}:`, { error: String(err) });
        }
      }
    }

    for (const listener of this.globalListeners) {
      try {
        listener(event);
      } catch (err: any) {
        logger.warn(`[MarketEventEngine] Global listener failed for ${event.type}:`, { error: String(err) });
      }
    }
  }

  // ==========================================
  // SUBSCRIPTION & PUB/SUB
  // ==========================================

  public subscribe<T = any>(type: MarketEventType, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler as EventHandler);

    return () => {
      this.listeners.get(type)?.delete(handler as EventHandler);
    };
  }

  public subscribeAll(handler: EventHandler): () => void {
    this.globalListeners.add(handler);
    return () => {
      this.globalListeners.delete(handler);
    };
  }

  public clearSubscribers(): void {
    this.listeners.clear();
    this.globalListeners.clear();
  }

  // ==========================================
  // NORMALIZED MARKET EVENT INGESTION
  // ==========================================

  /**
   * Ingests a closed candlestick bar into the event pipeline.
   */
  public ingestBar(
    symbol: string,
    candle: NormalizedCandle,
    timeframe: string = '1h',
    source: MarketEvent['source'] = this.mode === 'LIVE' ? 'LIVE_FEED' : 'HISTORICAL_REPLAY'
  ): MarketEvent<BarEventPayload> {
    return this.emitEvent<BarEventPayload>(
      'BAR_CLOSE',
      symbol,
      {
        timeframe,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        isClosed: true,
      },
      candle.timestamp,
      source
    );
  }

  /**
   * Ingests a market quote or ticker price update.
   */
  public ingestQuoteTick(
    symbol: string,
    price: number,
    provider: string = 'SYSTEM',
    timestamp?: number,
    bid?: number,
    ask?: number
  ): MarketEvent<QuoteTickPayload> {
    return this.emitEvent<QuoteTickPayload>(
      'QUOTE_TICK',
      symbol,
      {
        price,
        bid: bid ?? price,
        ask: ask ?? price,
        provider,
      },
      timestamp,
      this.mode === 'LIVE' ? 'LIVE_FEED' : 'HISTORICAL_REPLAY'
    );
  }

  // ==========================================
  // POSITION & SIGNAL LIFECYCLE STATE MACHINE
  // ==========================================

  /**
   * Registers a newly generated signal into the lifecycle tracker.
   */
  public registerSignal(
    signal: TradingSignal,
    initialState: SignalLifecycleState = 'CANDIDATE'
  ): MarketEvent<SignalLifecyclePayload> {
    const timestamp = signal.timestamp || this.getNow();

    const record = {
      state: initialState,
      signalId: signal.id,
      symbol: signal.symbol.toUpperCase(),
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      history: [{
        state: initialState,
        timestamp,
        price: signal.entryPrice,
        reason: 'Signal Initialized',
      }],
    };

    this.signalStates.set(signal.id, record);

    const eventType: MarketEventType = initialState === 'QUALIFIED' ? 'SIGNAL_QUALIFIED' : 'SIGNAL_CANDIDATE';

    return this.emitEvent<SignalLifecyclePayload>(
      eventType,
      signal.symbol,
      {
        signalId: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        newState: initialState,
        entryPrice: signal.entryPrice,
        currentPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        transitionReason: 'Initial Registration',
      },
      timestamp,
      'SCANNER_PIPELINE'
    );
  }

  /**
   * Transitions a tracked signal's state deterministically.
   * Rejects invalid state transitions (e.g., cannot revive an SL-hit or expired signal).
   */
  public transitionSignal(
    signalId: string,
    newState: SignalLifecycleState,
    currentPrice: number,
    timestamp?: number,
    reason?: string,
    milestoneDetails?: SignalLifecyclePayload['milestoneDetails']
  ): MarketEvent<SignalLifecyclePayload> | null {
    const record = this.signalStates.get(signalId);
    if (!record) {
      logger.warn(`[MarketEventEngine] Unknown signal ${signalId} requested transition to ${newState}`);
      return null;
    }

    const prevState = record.state;

    // Terminal state protection: once resolved, cannot transition further
    const terminalStates: SignalLifecycleState[] = ['SL_HIT', 'EXPIRED', 'CANCELLED'];
    if (terminalStates.includes(prevState)) {
      logger.warn(
        `[MarketEventEngine] Cannot transition signal ${signalId} from terminal state ${prevState} to ${newState}`
      );
      return null;
    }

    const eventTime = timestamp ?? this.getNow();

    // Update state and history
    record.state = newState;
    record.history.push({
      state: newState,
      timestamp: eventTime,
      price: currentPrice,
      reason,
    });

    let eventType: MarketEventType = 'SIGNAL_QUALIFIED';
    if (newState === 'WAITING_ENTRY' || newState === 'ACTIVE_POSITION') {
      eventType = 'SIGNAL_ENTRY_TRIGGERED';
    } else if (newState === 'TP1_HIT' || newState === 'TP2_HIT' || newState === 'TP3_HIT') {
      eventType = 'SIGNAL_TP_HIT';
    } else if (newState === 'SL_HIT') {
      eventType = 'SIGNAL_SL_HIT';
    } else if (newState === 'EXPIRED') {
      eventType = 'SIGNAL_EXPIRED';
    } else if (newState === 'CANCELLED') {
      eventType = 'SIGNAL_CANCELLED';
    } else if (newState === 'DISQUALIFIED') {
      eventType = 'SIGNAL_DISQUALIFIED';
    }

    return this.emitEvent<SignalLifecyclePayload>(
      eventType,
      record.symbol,
      {
        signalId,
        symbol: record.symbol,
        direction: record.direction,
        previousState: prevState,
        newState,
        entryPrice: record.entryPrice,
        currentPrice,
        stopLoss: record.stopLoss,
        takeProfit: record.takeProfit,
        tp1: record.tp1,
        tp2: record.tp2,
        tp3: record.tp3,
        transitionReason: reason,
        milestoneDetails,
      },
      eventTime,
      'LIFECYCLE_MONITOR'
    );
  }

  /**
   * Processes a market price update against all active signals to deterministically
   * trigger lifecycle transitions (entry, TP1, TP2, TP3, SL).
   */
  public evaluateActiveSignalsWithPrice(
    symbol: string,
    currentPrice: number,
    timestamp?: number
  ): Array<MarketEvent<SignalLifecyclePayload>> {
    const cleanSym = symbol.toUpperCase();
    const emittedEvents: Array<MarketEvent<SignalLifecyclePayload>> = [];
    const eventTime = timestamp ?? this.getNow();

    for (const [id, sig] of this.signalStates.entries()) {
      if (sig.symbol !== cleanSym) continue;

      // Skip terminal states
      if (sig.state === 'SL_HIT' || sig.state === 'EXPIRED' || sig.state === 'CANCELLED') {
        continue;
      }

      const isBuy = sig.direction === 'BUY';

      // 1. Check Stop Loss
      const isSlHit = isBuy ? currentPrice <= sig.stopLoss : currentPrice >= sig.stopLoss;
      if (isSlHit) {
        const ev = this.transitionSignal(id, 'SL_HIT', currentPrice, eventTime, 'Stop loss price level breached');
        if (ev) emittedEvents.push(ev);
        continue;
      }

      // 2. Check Take Profit milestones progressively
      if (sig.tp3 && (isBuy ? currentPrice >= sig.tp3 : currentPrice <= sig.tp3)) {
        if (sig.state !== 'TP3_HIT') {
          const ev = this.transitionSignal(id, 'TP3_HIT', currentPrice, eventTime, 'TP3 Target fully reached', {
            tpIndex: 3,
            pctGain: Number((Math.abs(currentPrice - sig.entryPrice) / sig.entryPrice * 100).toFixed(2)),
          });
          if (ev) emittedEvents.push(ev);
        }
      } else if (sig.tp2 && (isBuy ? currentPrice >= sig.tp2 : currentPrice <= sig.tp2)) {
        if (sig.state !== 'TP2_HIT' && sig.state !== 'TP3_HIT') {
          const ev = this.transitionSignal(id, 'TP2_HIT', currentPrice, eventTime, 'TP2 Target reached', {
            tpIndex: 2,
            pctGain: Number((Math.abs(currentPrice - sig.entryPrice) / sig.entryPrice * 100).toFixed(2)),
          });
          if (ev) emittedEvents.push(ev);
        }
      } else if (sig.tp1 && (isBuy ? currentPrice >= sig.tp1 : currentPrice <= sig.tp1)) {
        if (sig.state === 'CANDIDATE' || sig.state === 'QUALIFIED' || sig.state === 'ACTIVE_POSITION' || sig.state === 'WAITING_ENTRY') {
          const ev = this.transitionSignal(id, 'TP1_HIT', currentPrice, eventTime, 'TP1 Target reached', {
            tpIndex: 1,
            pctGain: Number((Math.abs(currentPrice - sig.entryPrice) / sig.entryPrice * 100).toFixed(2)),
          });
          if (ev) emittedEvents.push(ev);
        }
      }
    }

    return emittedEvents;
  }

  // ==========================================
  // HISTORICAL REPLAY KERNEL (QUANTCONNECT / NAUTILUS PATTERN)
  // ==========================================

  /**
   * Deterministically replays a sequence of historical candles, advancing simulated
   * clock step-by-step and emitting normalized bar events in chronological order.
   */
  public replayCandles(
    symbol: string,
    timeframe: string,
    candles: NormalizedCandle[]
  ): {
    eventsDispatched: number;
    startTime: number;
    endTime: number;
  } {
    if (!candles || candles.length === 0) {
      return { eventsDispatched: 0, startTime: 0, endTime: 0 };
    }

    // Sort chronologically ascending to strictly enforce causality
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const prevMode = this.mode;
    this.mode = 'HISTORICAL';

    let count = 0;
    const startTime = sorted[0].timestamp;
    const endTime = sorted[sorted.length - 1].timestamp;

    for (const c of sorted) {
      // 1. Advance simulation clock to candle open
      this.advanceClock(c.timestamp);

      // 2. Dispatch BAR_CLOSE event
      this.ingestBar(symbol, c, timeframe, 'HISTORICAL_REPLAY');
      count += 1;

      // 3. Evaluate any active signals against the bar extreme (High/Low) and close
      this.evaluateActiveSignalsWithPrice(symbol, c.close, c.timestamp);
    }

    this.mode = prevMode;

    return {
      eventsDispatched: count,
      startTime,
      endTime,
    };
  }

  // ==========================================
  // QUERY & AUDIT INSPECTION
  // ==========================================

  public getEventHistory(options?: {
    symbol?: string;
    type?: MarketEventType;
    fromTimestamp?: number;
    toTimestamp?: number;
    limit?: number;
  }): MarketEvent[] {
    let result = this.eventHistory;

    if (options?.symbol) {
      const sym = options.symbol.toUpperCase();
      result = result.filter(e => e.symbol === sym);
    }

    if (options?.type) {
      result = result.filter(e => e.type === options.type);
    }

    if (options?.fromTimestamp !== undefined) {
      result = result.filter(e => e.timestamp >= options.fromTimestamp!);
    }

    if (options?.toTimestamp !== undefined) {
      result = result.filter(e => e.timestamp <= options.toTimestamp!);
    }

    if (options?.limit && options.limit > 0) {
      result = result.slice(-options.limit);
    }

    return result;
  }

  public getSignalLifecycleHistory(signalId: string) {
    return this.signalStates.get(signalId);
  }

  public getTelemetry(): EngineTelemetry {
    return {
      mode: this.mode,
      currentClockTime: this.getNow(),
      totalEventsProcessed: this.sequenceCounter,
      lastSequenceNumber: this.sequenceCounter,
      eventsByType: { ...this.eventsByType },
      activeSignalsMonitored: Array.from(this.signalStates.values()).filter(
        s => s.state !== 'SL_HIT' && s.state !== 'EXPIRED' && s.state !== 'CANCELLED'
      ).length,
      outOfOrderEventsDetected: this.outOfOrderCount,
    };
  }

  public clear(): void {
    this.eventHistory = [];
    this.signalStates.clear();
    this.sequenceCounter = 0;
    this.eventsByType = {};
    this.outOfOrderCount = 0;
  }
}

// Global Singleton Instance for application-wide signal event routing
export const marketEventEngine = new MarketEventEngine({ mode: 'LIVE' });
