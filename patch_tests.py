import re

with open('tests/run-regression.ts', 'r') as f:
    code = f.read()

new_tests = """
    await test('CandidateRejectionTracker separates BUY and SELL for the same symbol (Identity Fix)', () => {
      const tracker = new CandidateRejectionTracker();
      
      // 1. BTCUSDT BUY + BTCUSDT SELL → two records.
      tracker.recordCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 75,
        primaryRejectionReason: 'REJECTED: RR',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
      });
      tracker.recordCandidate({
        symbol: 'BTCUSDT',
        direction: 'SELL',
        score: 72,
        primaryRejectionReason: 'REJECTED: STRUCTURE',
        failedGates: [StandardFailedGate.MARKET_STRUCTURE],
        finalDecision: 'REJECTED',
      });
      
      const records = tracker.getAllRecords();
      assert(records.length === 2, 'Must have exactly two separate records for BUY and SELL');
      const btcBuy = records.find(r => r.symbol === 'BTCUSDT' && r.direction === 'BUY');
      const btcSell = records.find(r => r.symbol === 'BTCUSDT' && r.direction === 'SELL');
      assert(btcBuy !== undefined, 'BTCUSDT BUY must exist');
      assert(btcSell !== undefined, 'BTCUSDT SELL must exist');
      assert(btcBuy!.failedGates.includes(StandardFailedGate.RR), 'BTCUSDT BUY must have RR failure');
      assert(btcSell!.failedGates.includes(StandardFailedGate.MARKET_STRUCTURE), 'BTCUSDT SELL must have STRUCTURE failure');
      
      // 2. BTCUSDT BUY repeated → same candidate identity.
      // 4. Historical records remain separate from current evaluation.
      // 5. Current evaluation does not inherit stale trade data.
      tracker.recordCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 80,
        primaryRejectionReason: 'REJECTED: FINAL_SCORE',
        failedGates: [StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD],
        finalDecision: 'REJECTED',
        tp1: 100000 // fresh trade data
      });
      
      const updatedRecords = tracker.getAllRecords();
      assert(updatedRecords.length === 2, 'Repeated BUY must overwrite existing BUY record, keeping total length 2');
      const updatedBtcBuy = updatedRecords.find(r => r.symbol === 'BTCUSDT' && r.direction === 'BUY');
      assert(updatedBtcBuy!.failedGates.includes(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD), 'Repeated BUY must reflect the latest failed gates');
      assert(!updatedBtcBuy!.failedGates.includes(StandardFailedGate.RR), 'Historical RR failure must not leak into current evaluation');
      assert(updatedBtcBuy!.tp1 === 100000, 'Current evaluation must have fresh trade data (tp1)');
      
      // 3. Two different symbols → two records.
      tracker.recordCandidate({
        symbol: 'ETHUSDT',
        direction: 'BUY',
        score: 60,
        primaryRejectionReason: 'REJECTED: MTF',
        failedGates: [StandardFailedGate.MTF_ALIGNMENT],
        finalDecision: 'REJECTED',
      });
      assert(tracker.getAllRecords().length === 3, 'Different symbol must create a new record');
    });
"""

pattern = """    await test('4. HourlyScanner aggregates candidate rejection details and derives categorized counters from finalized records', () => {"""

if pattern in code:
    with open('tests/run-regression.ts', 'w') as f:
        f.write(code.replace(pattern, new_tests + "\n" + pattern))
    print("Tests added successfully!")
else:
    print("Pattern not found!")
