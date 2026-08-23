const fs = require('fs');
let code = fs.readFileSync('src/server/signals/HourlyScanner.ts', 'utf8');

const blockToRemove = `        // GATE 65: Double check centralized final tradeability contract before dispatch
        const tradeabilityCheck = TradeRankingEngine.calculateFinalRequiredScore({
          symbol: sig.symbol,
          actualScore: score,
          regime: (sig as any).marketRegime,
          strategy: sig.strategy,
          assetClass: SymbolNormalizer.getAssetClassification(sig.symbol),
          signalThreshold: thresholds.signalThreshold,
        });

        if (!tradeabilityCheck.isExecutable || !tradeabilityCheck.passed) {
          logger.warn(\`[Hourly Scanner] Setup \${sig.symbol} failed final tradeability contract (score \${score} < \${tradeabilityCheck.finalRequiredScore}). Skipping.\`);
          continue;
        }`;

if (code.includes(blockToRemove)) {
    code = code.replace(blockToRemove, '');
    fs.writeFileSync('src/server/signals/HourlyScanner.ts', code);
    console.log("Success blockToRemove HourlyScanner");
} else {
    console.log("Failed blockToRemove HourlyScanner");
}
