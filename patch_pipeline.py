import re

with open('src/server/signals/StagedScannerPipeline.ts', 'r') as f:
    code = f.read()

pattern = """      candidates72Plus: candidatesThresholdPlusCount,
      rejected72PlusCandidates: rejectedThresholdPlusCount,"""
replacement = """      thresholdPlusCandidates: candidatesThresholdPlusCount,
      rejectedThresholdPlusCandidates: rejectedThresholdPlusCount,
      candidates72Plus: candidatesThresholdPlusCount, // Legacy alias
      rejected72PlusCandidates: rejectedThresholdPlusCount, // Legacy alias"""

if pattern in code:
    code = code.replace(pattern, replacement)
    with open('src/server/signals/StagedScannerPipeline.ts', 'w') as f:
        f.write(code)
    print("Patched StagedScannerPipeline")
else:
    print("Pattern not found in StagedScannerPipeline")

