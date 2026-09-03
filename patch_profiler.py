import re

with open('src/server/signals/ScanPerformanceProfiler.ts', 'r') as f:
    code = f.read()

# Replace interface fields
code = re.sub(
    r"  '72PlusCandidates': number;\n  rejected72PlusCandidates: number;",
    "  thresholdPlusCandidates: number;\n  rejectedThresholdPlusCandidates: number;\n  // Legacy aliases\n  '72PlusCandidates': number;\n  rejected72PlusCandidates: number;",
    code
)

# Replace class properties
code = re.sub(
    r"  private candidates72Plus: number = 0;\n  private rejected72PlusCandidates: number = 0;",
    "  private thresholdPlusCandidates: number = 0;\n  private rejectedThresholdPlusCandidates: number = 0;\n  // Legacy internal aliases\n  private candidates72Plus: number = 0;\n  private rejected72PlusCandidates: number = 0;",
    code
)

# Replace type definition
code = re.sub(
    r"    '72PlusCandidates': number;\n    candidates72Plus: number;\n    rejected72PlusCandidates: number;",
    "    thresholdPlusCandidates: number;\n    rejectedThresholdPlusCandidates: number;\n    // Legacy aliases\n    '72PlusCandidates': number;\n    candidates72Plus: number;\n    rejected72PlusCandidates: number;",
    code
)

# Replace assignments in finalizeMetrics() or similar
code = re.sub(
    r"    if \(metrics\['72PlusCandidates'\] !== undefined\) this\.candidates72Plus = metrics\['72PlusCandidates'\];\n    if \(metrics\.candidates72Plus !== undefined\) this\.candidates72Plus = metrics\.candidates72Plus;\n    if \(metrics\.rejected72PlusCandidates !== undefined\) this\.rejected72PlusCandidates = metrics\.rejected72PlusCandidates;",
    """    if (metrics.thresholdPlusCandidates !== undefined) this.thresholdPlusCandidates = metrics.thresholdPlusCandidates;
    if (metrics.rejectedThresholdPlusCandidates !== undefined) this.rejectedThresholdPlusCandidates = metrics.rejectedThresholdPlusCandidates;
    // Legacy support
    if (metrics['72PlusCandidates'] !== undefined) this.candidates72Plus = metrics['72PlusCandidates'];
    if (metrics.candidates72Plus !== undefined) this.candidates72Plus = metrics.candidates72Plus;
    if (metrics.rejected72PlusCandidates !== undefined) this.rejected72PlusCandidates = metrics.rejected72PlusCandidates;""",
    code
)

# Replace output dictionary in generatePerformanceReport()
code = re.sub(
    r"      '72PlusCandidates': this\.candidates72Plus,\n      rejected72PlusCandidates: this\.rejected72PlusCandidates,",
    """      thresholdPlusCandidates: this.thresholdPlusCandidates || this.candidates72Plus,
      rejectedThresholdPlusCandidates: this.rejectedThresholdPlusCandidates || this.rejected72PlusCandidates,
      // Legacy API aliases
      '72PlusCandidates': this.candidates72Plus || this.thresholdPlusCandidates,
      rejected72PlusCandidates: this.rejected72PlusCandidates || this.rejectedThresholdPlusCandidates,""",
    code
)

# Replace log string
code = re.sub(
    r"72\+=\$\{p\['72PlusCandidates'\]\}, Rejected72\+=\$\{p\.rejected72PlusCandidates\}",
    "Threshold+=${p.thresholdPlusCandidates || p['72PlusCandidates']}, RejectedThreshold+=${p.rejectedThresholdPlusCandidates || p.rejected72PlusCandidates}",
    code
)

with open('src/server/signals/ScanPerformanceProfiler.ts', 'w') as f:
    f.write(code)

print("Patched ScanPerformanceProfiler")
