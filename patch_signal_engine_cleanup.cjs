const fs = require('fs');
let code = fs.readFileSync('src/server/signals/SignalEngine.ts', 'utf8');

const blockToRemove = `          // GATE 65: Double check centralized final tradeability contract
          const tradeability = TradeRankingEngine.calculateFinalRequiredScore({
            symbol: sig.symbol,
            actualScore: sig.score,
            regime: sig.marketRegime,
            strategy: sig.strategy,
            assetClass: sig.assetClass,
            signalThreshold: thresholds.signalThreshold,
          });

          if (!tradeability.isExecutable || !tradeability.passed) {
            logger.warn(\`[SignalEngine] Final candidate \${sig.symbol} failed tradeability check: score \${sig.score} < \${tradeability.finalRequiredScore}. Skipped.\`);
            continue;
          }`;

if (code.includes(blockToRemove)) {
    code = code.replace(blockToRemove, '');
    fs.writeFileSync('src/server/signals/SignalEngine.ts', code);
    console.log("Success blockToRemove");
} else {
    console.log("Failed blockToRemove");
}
