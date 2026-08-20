const fs = require('fs');

const testCode = `
      // -----------------------------------------------------------------------
      // TEST 12: Expiration Logic (Single Source of Truth)
      // -----------------------------------------------------------------------
      {
        const now = Date.now();
        const configMs = serverConfig.getConfig().signalExpirationMs;
        
        const createSignal = (id, timeOffset, state = 'WAITING_ENTRY') => ({
          id, snapshotId: \`snap_\${id}\`, symbol: id, direction: 'BUY',
          entryPrice: 100, stopLoss: 90, takeProfit: 110, riskRewardRatio: 1.0, score: 80,
          rankTier: 'BEST_TRADE', strategy: 'Test', timeframe: '1m', dataSource: 'bitget',
          status: state, timestamp: now + timeOffset, expiresAt: now + timeOffset + configMs,
          notificationSent: false, notificationTimestamp: 0, date: new Date().toISOString().split('T')[0],
        });

        // Test subjects
        const beforeExpiry = createSignal('before_expiry', -configMs + 10000); // 10s before expiry
        const exactExpiry = createSignal('exact_expiry', -configMs); // Exactly at expiry (age >= maxTtl)
        const afterExpiry = createSignal('after_expiry', -configMs - 10000); // 10s after expiry
        const activeTrade = createSignal('active_after_expiry', -configMs - 10000, 'ACTIVE'); // Started, but now beyond original expiry
        const entryBeforeExpiry = createSignal('entry_before_expiry', -configMs - 10000); 
        const entryAfterExpiry = createSignal('entry_after_expiry', -configMs - 10000); 

        const signals = [beforeExpiry, exactExpiry, afterExpiry, activeTrade, entryBeforeExpiry, entryAfterExpiry];
        
        const savedStatuses = {};
        signals.forEach(s => savedStatuses[s.id] = s.status);
        
        ScannerPersistence.getActiveSignals = async () => signals;
        
        ScannerPersistence.updateSignalStatus = async (id, status) => {
          savedStatuses[id] = status;
          const sig = signals.find(s => s.id === id);
          if (sig) sig.status = status;
        };

        marketDataManager.getPrice = async () => null;

        // Custom candle provider to simulate entries
        marketDataManager.getCandles = async (symbol) => {
          if (symbol === 'entry_before_expiry') {
            // Candle happens BEFORE the expiration time
            return [{
              symbol, provider: 'bitget', timeframe: '1m',
              open: 95, high: 101, low: 95, close: 100, volume: 100,
              timestamp: entryBeforeExpiry.timestamp + configMs - 5000, // 5s before expiry
            }];
          }
          if (symbol === 'entry_after_expiry') {
            // Candle happens AFTER the expiration time
            return [{
              symbol, provider: 'bitget', timeframe: '1m',
              open: 95, high: 101, low: 95, close: 100, volume: 100,
              timestamp: entryAfterExpiry.timestamp + configMs + 5000, // 5s after expiry
            }];
          }
          return [];
        };

        await SignalLifecycleManager.evaluateActiveSignals();

        results.push({
          name: 'Expiration Logic - Before Expiry',
          passed: savedStatuses['before_expiry'] === 'WAITING_ENTRY',
          message: \`Expected WAITING_ENTRY, got \${savedStatuses['before_expiry']}\`
        });
        results.push({
          name: 'Expiration Logic - Exact Expiry Boundary',
          passed: savedStatuses['exact_expiry'] === 'EXPIRED',
          message: \`Expected EXPIRED, got \${savedStatuses['exact_expiry']}\`
        });
        results.push({
          name: 'Expiration Logic - After Expiry',
          passed: savedStatuses['after_expiry'] === 'EXPIRED',
          message: \`Expected EXPIRED, got \${savedStatuses['after_expiry']}\`
        });
        results.push({
          name: 'Expiration Logic - Active Trade After Original Expiry',
          passed: savedStatuses['active_after_expiry'] === 'ACTIVE',
          message: \`Expected ACTIVE, got \${savedStatuses['active_after_expiry']}\`
        });
        results.push({
          name: 'Expiration Logic - Entry Hit Before Expiry',
          passed: savedStatuses['entry_before_expiry'] === 'ACTIVE',
          message: \`Expected ACTIVE, got \${savedStatuses['entry_before_expiry']}\`
        });
        results.push({
          name: 'Expiration Logic - Entry Hit After Expiry',
          passed: savedStatuses['entry_after_expiry'] === 'EXPIRED',
          message: \`Expected EXPIRED, got \${savedStatuses['entry_after_expiry']}\`
        });
      }
`;

const file = 'src/server/signals/OutcomeTrackerTester.ts';
let content = fs.readFileSync(file, 'utf8');

// Insert serverConfig import if not present
if (!content.includes("serverConfig")) {
    content = content.replace(
        "import { SignalValidator } from './SignalValidator.js';",
        "import { SignalValidator } from './SignalValidator.js';\nimport { serverConfig } from '../config.js';"
    );
}

const pos = content.indexOf("    } catch (err) {");
if (pos !== -1) {
    content = content.slice(0, pos) + testCode + content.slice(pos);
    fs.writeFileSync(file, content);
    console.log("Successfully inserted TEST 12");
} else {
    console.error("Could not find insertion point");
}
