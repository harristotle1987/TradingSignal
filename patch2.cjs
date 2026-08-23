const fs = require('fs');
let code = fs.readFileSync('src/server/signals/SignalEngine.ts', 'utf8');

code = code.replace(
  "async generateSignal(symbol = 'EURUSD', category?: string): Promise<SignalGenerationResponse> {",
  "async generateSignal(symbol = 'EURUSD', category?: string, persistAndActivate: boolean = true): Promise<SignalGenerationResponse> {"
);

const persistenceBlock = `          // Atomically increment cap
          const inc = await ScannerPersistence.tryIncrementCap(thresholds.dailySignalCap || 10);
          if (!inc.allowed) {
            logger.warn(\`[SignalEngine] Daily cap reached during atomic increment. Stopping further dispatches.\`);
            break;
          }

          // GATE 60 & GATE 65: Mark as officially tradeable before persistence
          sig.isTradeableSignal = true;
          sig.signalClassification = 'TRADEABLE';

          // PERSIST & CONFIRM PERSISTENCE
          const persRes = await ScannerPersistence.recordSentSignal(sig);
          const logRes = await SignalLogger.logSignal(sig, sig.marketRegime || 'TREND');

          if (!persRes.success || !logRes.success || logRes.status !== 'TRADEABLE_RECORD_PERSISTED') {
            logger.error(\`[SignalEngine] Persistence failed for \${sig.symbol}. Rolling back cap and aborting dispatch.\`, { persError: persRes.error, logError: logRes.error });
            await ScannerPersistence.releaseCap(inc.reservationId);
            sig.isTradeableSignal = false;
            sig.signalClassification = 'DIAGNOSTIC';
            continue;
          }

          // COMMIT CAP RESERVATION!
          await ScannerPersistence.commitCap(inc.reservationId);

          // ONLY AFTER BOTH SUCCEED: activate signal
          this.activeSignals.set(sig.symbol, sig);

          // Record Fingerprint, Cooldown, and Accepted Audit Explanation
          const fp = SignalFingerprint.recordFingerprint({
            symbol: sig.symbol,
            direction: sig.direction,
            entryPrice: sig.entryPrice,
            timeframe: sig.timeframe,
            primaryStrategy: sig.strategy,
          });

          CooldownManager.recordSignalEmit(sig.symbol, sig.strategy, sig.timestamp);`;

const newPersistenceBlock = `          if (persistAndActivate) {
            // Atomically increment cap
            const inc = await ScannerPersistence.tryIncrementCap(thresholds.dailySignalCap || 10);
            if (!inc.allowed) {
              logger.warn(\`[SignalEngine] Daily cap reached during atomic increment. Stopping further dispatches.\`);
              break;
            }

            // GATE 60 & GATE 65: Mark as officially tradeable before persistence
            sig.isTradeableSignal = true;
            sig.signalClassification = 'TRADEABLE';

            // PERSIST & CONFIRM PERSISTENCE
            const persRes = await ScannerPersistence.recordSentSignal(sig);
            const logRes = await SignalLogger.logSignal(sig, sig.marketRegime || 'TREND');

            if (!persRes.success || !logRes.success || logRes.status !== 'TRADEABLE_RECORD_PERSISTED') {
              logger.error(\`[SignalEngine] Persistence failed for \${sig.symbol}. Rolling back cap and aborting dispatch.\`, { persError: persRes.error, logError: logRes.error });
              await ScannerPersistence.releaseCap(inc.reservationId);
              sig.isTradeableSignal = false;
              sig.signalClassification = 'DIAGNOSTIC';
              continue;
            }

            // COMMIT CAP RESERVATION!
            await ScannerPersistence.commitCap(inc.reservationId);

            // ONLY AFTER BOTH SUCCEED: activate signal
            this.activeSignals.set(sig.symbol, sig);

            // Record Fingerprint, Cooldown, and Accepted Audit Explanation
            const fp = SignalFingerprint.recordFingerprint({
              symbol: sig.symbol,
              direction: sig.direction,
              entryPrice: sig.entryPrice,
              timeframe: sig.timeframe,
              primaryStrategy: sig.strategy,
            });

            CooldownManager.recordSignalEmit(sig.symbol, sig.strategy, sig.timestamp);
          }`;

if (code.includes(persistenceBlock)) {
    code = code.replace(persistenceBlock, newPersistenceBlock);
    fs.writeFileSync('src/server/signals/SignalEngine.ts', code);
    console.log("Success");
} else {
    console.log("Failed to find block");
}
