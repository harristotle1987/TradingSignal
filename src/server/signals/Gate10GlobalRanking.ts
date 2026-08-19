import { TradingSignal } from '../../types/index.js';
import { ValidatedCandidate } from './TradeRankingEngine.js';

export interface Gate10Result {
  rankedCandidates: ValidatedCandidate[];
  selectedSignals: TradingSignal[];
  reasons: string[];
}

export class Gate10GlobalRanking {
  public static rankAndSelect(candidates: ValidatedCandidate[]): Gate10Result {
    const reasons: string[] = [];
    
    // 1. Rank by final score (and other quality factors)
    const sorted = [...candidates].sort((a, b) => {
       const scoreDiff = (b.signal.score || 0) - (a.signal.score || 0);
       if (scoreDiff !== 0) return scoreDiff;
       
       // Tie breaker: higher confidence score
       return (b.aiConfidence || 0) - (a.aiConfidence || 0);
    });
    
    // 2. Select top opportunities (e.g., max 3 simultaneous signals to avoid correlation risk)
    const maxSignals = 3;
    const selectedSignals: TradingSignal[] = [];
    
    for (const cand of sorted) {
      if (selectedSignals.length >= maxSignals) break;
      
      // Additional correlation check could be integrated here, but using existing CorrelationFilter for now
      selectedSignals.push(cand.signal);
    }
    
    reasons.push(`Ranked ${candidates.length} candidates. Selected top ${selectedSignals.length} based on score and AI confidence.`);
    
    return {
      rankedCandidates: sorted,
      selectedSignals,
      reasons
    };
  }
}
