import assert from 'assert';
import {
  MarketEventEngine,
  MarketEvent,
  BarEventPayload,
  QuoteTickPayload,
  SignalLifecyclePayload,
} from '../src/server/signals/MarketEventEngine.js';
import { NormalizedCandle, TradingSignal } from '../src/types/index.js';

export async function runMarketEventTests() {
  console.log('\n--- Running MarketEventEngine Tests ---');

  // Test 1: Normalized Market Event Envelope & Monotonic Sequence Numbering
  console.log('Test 1: Uniform event envelope with monotonic sequencing');
  const engine = new MarketEventEngine({ mode: 'LIVE' });
  const event1 = engine.emitEvent('QUOTE_TICK', 'BTCUSDT', { price: 65000, provider: 'TEST' });
  const event2 = engine.emitEvent('QUOTE_TICK', 'BTCUSDT', { price: 65100, provider: 'TEST' });

  assert(event1.id.startsWith('evt_'), 'Event ID should start with evt_');
  assert.strictEqual(event1.sequenceNumber, 1, 'First event sequenceNumber should be 1');
  assert.strictEqual(event2.sequenceNumber, 2, 'Second event sequenceNumber should be 2');
  assert.strictEqual(event1.symbol, 'BTCUSDT');
  assert.strictEqual(event1.type, 'QUOTE_TICK');
  assert.strictEqual((event1.payload as QuoteTickPayload).price, 65000);
  console.log('  -> Normalized envelope & sequencing verified.');

  // Test 2: Deterministic Historical Clock & Zero Look-Ahead Protection
  console.log('Test 2: Deterministic simulation clock in HISTORICAL mode');
  const histEngine = new MarketEventEngine({ mode: 'HISTORICAL', strictTimeOrdering: true });
  assert.strictEqual(histEngine.getMode(), 'HISTORICAL');
  assert.strictEqual(histEngine.getNow(), 0, 'Initial historical clock should be 0');

  const t1 = 1700000000000;
  const t2 = 1700000060000; // +1 minute

  histEngine.emitEvent('BAR_CLOSE', 'ETHUSDT', { close: 3400 }, t1, 'HISTORICAL_REPLAY');
  assert.strictEqual(histEngine.getNow(), t1, 'Simulated clock should advance to t1');

  histEngine.emitEvent('BAR_CLOSE', 'ETHUSDT', { close: 3420 }, t2, 'HISTORICAL_REPLAY');
  assert.strictEqual(histEngine.getNow(), t2, 'Simulated clock should advance to t2');

  // Verify warning on backward time
  const tOld = t1 - 10000;
  histEngine.emitEvent('BAR_CLOSE', 'ETHUSDT', { close: 3380 }, tOld, 'HISTORICAL_REPLAY');
  const telemetry = histEngine.getTelemetry();
  assert(telemetry.outOfOrderEventsDetected >= 1, 'Out of order event must be registered in telemetry');
  console.log('  -> Deterministic clock & out-of-order detection verified.');

  // Test 3: Pub/Sub Listener Mechanism (Consistent in Live and Historical modes)
  console.log('Test 3: Event dispatcher and pub/sub listener registration');
  const receivedEvents: MarketEvent[] = [];
  const unsubscribe = engine.subscribe<QuoteTickPayload>('QUOTE_TICK', (ev) => {
    receivedEvents.push(ev);
  });

  engine.emitEvent('QUOTE_TICK', 'SOLUSDT', { price: 155, provider: 'TEST' });
  assert.strictEqual(receivedEvents.length, 1, 'Subscriber should have received 1 event');
  assert.strictEqual(receivedEvents[0].symbol, 'SOLUSDT');
  assert.strictEqual(receivedEvents[0].payload.price, 155);

  // Test unsubscribe
  unsubscribe();
  engine.emitEvent('QUOTE_TICK', 'SOLUSDT', { price: 156, provider: 'TEST' });
  assert.strictEqual(receivedEvents.length, 1, 'No additional events received after unsubscribing');
  console.log('  -> Pub/sub mechanics verified.');

  // Test 4: Position / Signal Lifecycle State Machine
  console.log('Test 4: Signal lifecycle tracking, transitions, and terminal protection');
  const signalEngine = new MarketEventEngine({ mode: 'LIVE' });
  const mockSignal: TradingSignal = {
    id: 'sig_lifecycle_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 65000,
    stopLoss: 63000,
    takeProfit: 71000,
    tp1: 67000,
    tp2: 69000,
    tp3: 71000,
    timestamp: Date.now(),
  } as any;

  // Initial candidate registration
  const regEvent = signalEngine.registerSignal(mockSignal, 'CANDIDATE');
  assert.strictEqual(regEvent.type, 'SIGNAL_CANDIDATE');
  assert.strictEqual(regEvent.payload.newState, 'CANDIDATE');

  // Transition to QUALIFIED
  const qualEvent = signalEngine.transitionSignal(mockSignal.id, 'QUALIFIED', 65000, Date.now(), 'Gates passed');
  assert(qualEvent !== null, 'Transition to QUALIFIED should succeed');
  assert.strictEqual(qualEvent!.type, 'SIGNAL_QUALIFIED');

  // Transition to ACTIVE_POSITION
  const actEvent = signalEngine.transitionSignal(mockSignal.id, 'ACTIVE_POSITION', 65000, Date.now(), 'Entry price triggered');
  assert(actEvent !== null, 'Transition to ACTIVE_POSITION should succeed');
  assert.strictEqual(actEvent!.type, 'SIGNAL_ENTRY_TRIGGERED');

  // Transition to TP1_HIT
  const tpEvent = signalEngine.transitionSignal(mockSignal.id, 'TP1_HIT', 67000, Date.now(), 'TP1 milestone hit');
  assert(tpEvent !== null, 'Transition to TP1_HIT should succeed');
  assert.strictEqual(tpEvent!.type, 'SIGNAL_TP_HIT');

  // Transition to terminal SL_HIT
  const slEvent = signalEngine.transitionSignal(mockSignal.id, 'SL_HIT', 63000, Date.now(), 'Stop loss triggered');
  assert(slEvent !== null, 'Transition to SL_HIT should succeed');
  assert.strictEqual(slEvent!.type, 'SIGNAL_SL_HIT');

  // Protection: Attempting transition after terminal SL_HIT must be blocked
  const illegalTransition = signalEngine.transitionSignal(mockSignal.id, 'ACTIVE_POSITION', 65000, Date.now(), 'Attempted revival');
  assert.strictEqual(illegalTransition, null, 'Must reject transition out of terminal state');

  const history = signalEngine.getSignalLifecycleHistory(mockSignal.id);
  assert(history !== undefined, 'Signal history should be recorded');
  assert.strictEqual(history!.history.length, 5, 'Should record 5 distinct lifecycle transitions');
  console.log('  -> Signal lifecycle state machine and terminal protection verified.');

  // Test 5: Price Evaluation Driving Lifecycle Milestones
  console.log('Test 5: Evaluate active signals dynamically against incoming market prices');
  const priceEngine = new MarketEventEngine({ mode: 'LIVE' });
  const activeSig: TradingSignal = {
    id: 'sig_price_test',
    symbol: 'ETHUSDT',
    direction: 'BUY',
    entryPrice: 3500,
    stopLoss: 3300,
    takeProfit: 3900,
    tp1: 3600,
    tp2: 3750,
    tp3: 3900,
    timestamp: Date.now(),
  } as any;

  priceEngine.registerSignal(activeSig, 'ACTIVE_POSITION');

  // Incoming price reaches TP1
  const tp1Events = priceEngine.evaluateActiveSignalsWithPrice('ETHUSDT', 3650);
  assert.strictEqual(tp1Events.length, 1, 'Should emit 1 event for reaching TP1');
  assert.strictEqual(tp1Events[0].type, 'SIGNAL_TP_HIT');
  assert.strictEqual(tp1Events[0].payload.newState, 'TP1_HIT');

  // Incoming price breaches SL
  const slEvents = priceEngine.evaluateActiveSignalsWithPrice('ETHUSDT', 3250);
  assert.strictEqual(slEvents.length, 1, 'Should emit 1 event for reaching SL');
  assert.strictEqual(slEvents[0].type, 'SIGNAL_SL_HIT');
  assert.strictEqual(slEvents[0].payload.newState, 'SL_HIT');
  console.log('  -> Active signal price progression verified.');

  // Test 6: Deterministic Historical Candle Replay (QuantConnect/Nautilus Pattern)
  console.log('Test 6: Historical candle replay processing step-by-step');
  const replayEngine = new MarketEventEngine({ mode: 'HISTORICAL' });
  const baseTime = 1710000000000;
  const mockCandles: NormalizedCandle[] = [
    { timestamp: baseTime, open: 100, high: 105, low: 98, close: 103, volume: 1000, symbol: 'SOLUSDT', provider: 'TEST', timeframe: '1h' },
    { timestamp: baseTime + 3600000, open: 103, high: 108, low: 102, close: 107, volume: 1200, symbol: 'SOLUSDT', provider: 'TEST', timeframe: '1h' },
    { timestamp: baseTime + 7200000, open: 107, high: 110, low: 104, close: 109, volume: 1500, symbol: 'SOLUSDT', provider: 'TEST', timeframe: '1h' },
  ];

  const replayResult = replayEngine.replayCandles('SOLUSDT', '1h', mockCandles);
  assert.strictEqual(replayResult.eventsDispatched, 3, 'Should dispatch exactly 3 bar events');
  assert.strictEqual(replayResult.startTime, baseTime);
  assert.strictEqual(replayResult.endTime, baseTime + 7200000);

  const histBars = replayEngine.getEventHistory({ symbol: 'SOLUSDT', type: 'BAR_CLOSE' });
  assert.strictEqual(histBars.length, 3, 'History should contain 3 closed bar events');
  assert.strictEqual((histBars[0].payload as BarEventPayload).close, 103);
  assert.strictEqual((histBars[2].payload as BarEventPayload).close, 109);
  console.log('  -> Historical candle replay completed cleanly.');

  // Test 7: Strict Signal-Only Guarantee (No broker execution API exists)
  console.log('Test 7: Verify signal-only boundary (no order routing or broker execution)');
  assert((replayEngine as any).placeOrder === undefined, 'No placeOrder method allowed');
  assert((replayEngine as any).executeTrade === undefined, 'No executeTrade method allowed');
  assert((replayEngine as any).sendOrderToBroker === undefined, 'No broker dispatch allowed');
  console.log('  -> Signal-only boundary strictly intact.');

  console.log('\n\x1b[32m[MARKET EVENT SUCCESS] All MarketEventEngine tests passed successfully!\x1b[0m\n');
}

// Run standalone if executed directly
if (process.argv[1]?.endsWith('market-event-engine.test.ts')) {
  runMarketEventTests().catch((err) => {
    console.error('MarketEventEngine test error:', err);
    process.exit(1);
  });
}
