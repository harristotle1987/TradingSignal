import re

with open('src/server/signals/CandidateRejectionTracker.ts', 'r') as f:
    code = f.read()

pattern = """    if (cleanAudit.tp3RR === 0) delete cleanAudit.tp3RR;

    const existing = this.records.get(cleanAudit.symbol);
    if (existing) {
      // Telemetry strictly reflects the CURRENT evaluation's failed gates,
      // never a union of historical failed gates.
      const everReachedThreshold = (existing.score >= minThreshold) || (existing.scoreBeforeGate6 ?? 0) >= minThreshold || (existing.everReachedThreshold === true) || isThresholdPlusRejected;
      const isStillThresholdPlusRejected = (everReachedThreshold || effectiveScore >= minThreshold) && cleanAudit.finalDecision === 'REJECTED';

      this.records.set(cleanAudit.symbol, {
        ...cleanAudit,
        score: effectiveScore,
        finalScore: cleanAudit.finalScore ?? effectiveScore,
        failedGates,
        isQualifiedRejected: isStillThresholdPlusRejected,
        everReachedThreshold,
        statusText,
        rejectionSummary,
        timestamp,
      });
    } else {
      this.records.set(cleanAudit.symbol, {
        ...cleanAudit,
        score: effectiveScore,
        finalScore: cleanAudit.finalScore ?? effectiveScore,
        failedGates,
        isQualifiedRejected: isThresholdPlusRejected,
        everReachedThreshold: isThresholdPlusRejected,
        statusText,
        rejectionSummary,
        timestamp,
      });
    }

    // Output structured console log for candidate rejection audit
    this.logCandidateAudit(this.records.get(cleanAudit.symbol)!);
"""

replacement = """    if (cleanAudit.tp3RR === 0) delete cleanAudit.tp3RR;

    const candidateKey = `${cleanAudit.symbol}_${cleanAudit.direction}`;
    const existing = this.records.get(candidateKey);
    if (existing) {
      // Telemetry strictly reflects the CURRENT evaluation's failed gates,
      // never a union of historical failed gates.
      const everReachedThreshold = (existing.score >= minThreshold) || (existing.scoreBeforeGate6 ?? 0) >= minThreshold || (existing.everReachedThreshold === true) || isThresholdPlusRejected;
      const isStillThresholdPlusRejected = (everReachedThreshold || effectiveScore >= minThreshold) && cleanAudit.finalDecision === 'REJECTED';

      this.records.set(candidateKey, {
        ...cleanAudit,
        score: effectiveScore,
        finalScore: cleanAudit.finalScore ?? effectiveScore,
        failedGates,
        isQualifiedRejected: isStillThresholdPlusRejected,
        everReachedThreshold,
        statusText,
        rejectionSummary,
        timestamp,
      });
    } else {
      this.records.set(candidateKey, {
        ...cleanAudit,
        score: effectiveScore,
        finalScore: cleanAudit.finalScore ?? effectiveScore,
        failedGates,
        isQualifiedRejected: isThresholdPlusRejected,
        everReachedThreshold: isThresholdPlusRejected,
        statusText,
        rejectionSummary,
        timestamp,
      });
    }

    // Output structured console log for candidate rejection audit
    this.logCandidateAudit(this.records.get(candidateKey)!);
"""

if pattern in code:
    with open('src/server/signals/CandidateRejectionTracker.ts', 'w') as f:
        f.write(code.replace(pattern, replacement))
    print("Replaced successfully!")
else:
    print("Pattern not found!")
