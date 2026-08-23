const fs = require('fs');
let code = fs.readFileSync('src/server/signals/TradeRankingEngine.ts', 'utf8');

const startStr = "  /**\n   * Evaluates, ranks, and filters validated candidates based on the centralized scoring policy.\n   */";
const endStr = "return Math.min(100, Math.max(0, baseScore + aiAdjustment + rsAdjustment - corrPenalty));\n  }";

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex !== -1 && endIndex !== -1) {
    const pre = code.substring(0, startIndex);
    const post = code.substring(endIndex + endStr.length);
    
    const replacement = `  /**
   * Evaluates, ranks, and filters validated candidates based on the centralized scoring policy.
   */
  static rankOpportunities(candidates: ValidatedCandidate[]): RankingResult {
    const rejectedCandidates: Array<{ symbol: string; reason: string }> = [];
    const thresholds = serverConfig.getConfig().thresholds;

    // 1. Calculate Core and Ranking Score
    const scoredCandidates = candidates.map((cand) => {
      const coreScore = cand.scoring.score;
      return {
        ...cand,
        coreScore,
        rankingScore: this.computeRankingScore(cand, coreScore),
      };
    });

    // 2. Classify and Filter based purely on core tradeability (GATE 80)
    const validCandidates: Array<ValidatedCandidate & { coreScore: number; rankingScore: number; rankTier: RankTier }> = [];
        
    for (const cand of scoredCandidates) {
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
      
      validCandidates.push({ ...cand, rankTier: 'SUGGESTION' });
    }

    // Sort by rankingScore descending (highest first)
    validCandidates.sort((a, b) => b.rankingScore - a.rankingScore);
        
    // Assign rank tiers based on rank order (Rank 1: BEST_TRADE, Rank 2: SECOND_BEST, Rank 3+: SUGGESTION)
    validCandidates.forEach((cand, idx) => {
      if (idx === 0) {
        cand.rankTier = 'BEST_TRADE';
        cand.signal.rankTier = 'BEST_TRADE';
        cand.signal.isBestTrade = true;
        cand.signal.isSecondBest = false;
        cand.signal.isTopTrade = true;
      } else if (idx === 1) {
        cand.rankTier = 'SECOND_BEST';
        cand.signal.rankTier = 'SECOND_BEST';
        cand.signal.isBestTrade = false;
        cand.signal.isSecondBest = true;
        cand.signal.isTopTrade = true;
      } else {
        cand.rankTier = 'SUGGESTION';
        cand.signal.rankTier = 'SUGGESTION';
        cand.signal.isBestTrade = false;
        cand.signal.isSecondBest = false;
        cand.signal.isTopTrade = false;
      }
    });

    // 3. Organization Logic (assigning top trades/suggestions)
    return this.organizeRankedCandidates(validCandidates, rejectedCandidates);
  }

  private static organizeRankedCandidates(
    validCandidates: Array<ValidatedCandidate & { coreScore: number; rankingScore: number; rankTier: RankTier }>,
    rejectedCandidates: Array<{ symbol: string; reason: string }>
  ): RankingResult {
    const topTrades = validCandidates.slice(0, 2).map((c) => c.signal);
    const suggestions = validCandidates.slice(2, 5).map((c) => c.signal);
        
    return {
      bestTrade: topTrades[0],
      secondBest: topTrades[1],
      suggestions,
      topTrades,
      allRanked: [...topTrades, ...suggestions],
      rejectedCandidates,
    };
  }

  private static computeRankingScore(candidate: ValidatedCandidate, coreScore: number): number {
    const { aiConfidence, signal } = candidate;
    const aiAdjustment = (typeof aiConfidence === 'number' && !isNaN(aiConfidence))
      ? ((aiConfidence - 70) / 30) * 3
      : 0;
    
    const rsScore = signal.relativeStrengthScore ?? 50;
    const rsAdjustment = ((rsScore - 50) / 50) * 2; // Subtle ±2 confidence modifier based on universe leadership
    const corrPenalty = signal.correlationPenalty ?? 0;
    
    return Math.min(100, Math.max(0, coreScore + aiAdjustment + rsAdjustment - corrPenalty));
  }`;
    
    fs.writeFileSync('src/server/signals/TradeRankingEngine.ts', pre + replacement + post);
    console.log("Success");
} else {
    console.log("Start: ", startIndex, "End:", endIndex);
}
