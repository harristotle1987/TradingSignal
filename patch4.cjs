const fs = require('fs');
let code = fs.readFileSync('src/server/signals/TradeRankingEngine.ts', 'utf8');

const replacement = `
      // Resolve centralized final tradeability evaluation using strictly the CORE SCORE
      const tradeability = this.calculateFinalRequiredScore({
        symbol: cand.signal.symbol,
        actualScore: cand.coreScore,
        regime: cand.signal.marketRegime || cand.scoring.marketRegime,
        strategy: cand.signal.strategy,
        assetClass: cand.signal.assetClass,
        signalThreshold: thresholds.signalThreshold,
      });

      if (!tradeability.isExecutable || !tradeability.passed) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: tradeability.rejectionReason || \`REJECTED: SCORE_BELOW_FINAL_THRESHOLD. Core Score \${cand.coreScore} < \${tradeability.finalRequiredScore}.\`,
        });
        continue;
      }
      
      // Attach the ranking score to the signal so downstream processes (like HourlyScanner) can use it for cross-asset ranking
      (cand.signal as any).rankingScore = cand.rankingScore;
      (cand.signal as any).coreScore = cand.coreScore;

      validCandidates.push({ ...cand, rankTier: 'SUGGESTION' });
`;

const regex = /\/\/\s*Resolve centralized final tradeability evaluation using strictly the CORE SCORE(.|\n)*?validCandidates\.push\(\{ \.\.\.cand, rankTier: 'SUGGESTION' \}\);/m;

if (regex.test(code)) {
    code = code.replace(regex, replacement.trim());
    fs.writeFileSync('src/server/signals/TradeRankingEngine.ts', code);
    console.log("Success");
} else {
    console.log("Regex mismatch");
}
