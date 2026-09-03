import re

with open('src/components/SignalHistoryPanel.tsx', 'r') as f:
    code = f.read()

code = code.replace("rejected72PlusCandidates", "rejectedThresholdPlusCandidates")
code = code.replace("72PLUS_REJECTED", "THRESHOLD_REJECTED")
code = code.replace("70+ Rejected", "High-Score Rejected")
code = code.replace("70+ REJECTED SETUPS", "HIGH-SCORE REJECTED SETUPS") # Just in case

with open('src/components/SignalHistoryPanel.tsx', 'w') as f:
    f.write(code)

with open('src/components/SignalsPage.tsx', 'r') as f:
    code = f.read()

code = code.replace("rejected72PlusCandidates", "rejectedThresholdPlusCandidates")
code = code.replace("setRejected72PlusCandidates", "setRejectedThresholdPlusCandidates")

with open('src/components/SignalsPage.tsx', 'w') as f:
    f.write(code)

print("Patched history panel")
