import re

with open('src/components/RejectedThresholdPanel.tsx', 'r') as f:
    code = f.read()

code = code.replace("Rejected72PlusPanel", "RejectedThresholdPanel")
code = code.replace("72+ HIGH-SCORE REJECTED SETUPS", "HIGH-SCORE REJECTED SETUPS")
code = code.replace("72+ High-Score Setups", "High-Score Setups")

with open('src/components/RejectedThresholdPanel.tsx', 'w') as f:
    f.write(code)

with open('src/components/AiMarketScannerWidget.tsx', 'r') as f:
    code2 = f.read()

code2 = code2.replace("Rejected72PlusPanel", "RejectedThresholdPanel")
code2 = code2.replace("is72Plus", "isThresholdPlus")
code2 = code2.replace("72+ HIGH-SCORE REJECTED SETUPS", "HIGH-SCORE REJECTED SETUPS")

with open('src/components/AiMarketScannerWidget.tsx', 'w') as f:
    f.write(code2)

with open('src/components/AssetClassScanner.tsx', 'r') as f:
    code3 = f.read()

code3 = code3.replace("Rejected72PlusPanel", "RejectedThresholdPanel")
code3 = code3.replace("72+ HIGH-SCORE REJECTED SETUPS", "HIGH-SCORE REJECTED SETUPS")

with open('src/components/AssetClassScanner.tsx', 'w') as f:
    f.write(code3)

print("Patched UI components")
