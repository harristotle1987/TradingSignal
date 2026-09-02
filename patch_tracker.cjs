const fs = require('fs');
const file = 'src/server/signals/CandidateRejectionTracker.ts';
let code = fs.readFileSync(file, 'utf8');

// Fix getCategorizedRejectionCounts
code = code.replace(
  /public getCategorizedRejectionCounts.*?return \{/s,
`public getCategorizedRejectionCounts(): {
    candidatesRejectedBeforeMTF: number;
    candidatesRejectedByMTF: number;
    candidatesRejectedByScore: number;
    candidatesRejectedByRR: number;
    candidatesRejectedByStructure: number;
  } {
    let beforeMTF = 0;
    let byMTF = 0;
    let byScore = 0;
    let byRR = 0;
    let byStructure = 0;

    for (const record of this.records.values()) {
      if (record.finalDecision === 'REJECTED' || record.failedGates.length > 0) {
        const isBeforeMTF =
          record.failedGates.includes(StandardFailedGate.FINAL_SCORE_UNREACHABLE) ||
          record.stage === 'Gate 6 Pre-Audit' ||
          record.stage === 'Stage 0' ||
          record.stage === 'Stage 1';

        const isMTF = record.failedGates.includes(StandardFailedGate.MTF_ALIGNMENT);
        const isScore = record.failedGates.includes(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD);
        const isRR = record.failedGates.includes(StandardFailedGate.RR) || record.failedGates.includes('RR_INVALID' as StandardFailedGate);
        const isStructure = record.failedGates.includes(StandardFailedGate.MARKET_STRUCTURE);

        if (isBeforeMTF) beforeMTF++;
        if (isMTF) byMTF++;
        if (isScore) byScore++;
        if (isRR) byRR++;
        if (isStructure) byStructure++;
      }
    }

    return {`
);

// Fix getAggregatedRejectionReasons
code = code.replace(
  /public getAggregatedRejectionReasons.*?return counts;/s,
`public getAggregatedRejectionReasons(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of this.records.values()) {
      if (record.finalDecision === 'REJECTED' || record.failedGates.length > 0) {
        if (record.failedGates && record.failedGates.length > 0) {
          const uniqueGates = Array.from(new Set(record.failedGates));
          for (const gate of uniqueGates) {
            counts[gate] = (counts[gate] || 0) + 1;
          }
        } else {
          counts['OTHER_REJECTION'] = (counts['OTHER_REJECTION'] || 0) + 1;
        }
      }
    }
    return counts;`
);

fs.writeFileSync(file, code);
