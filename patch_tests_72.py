import re

with open('tests/run-regression.ts', 'r') as f:
    code = f.read()

code = code.replace("rejected 72+ candidates", "rejected high-score candidates")
code = code.replace("stale 72Plus variable", "stale 72Plus variable")

with open('tests/run-regression.ts', 'w') as f:
    f.write(code)

print("Patched tests")
