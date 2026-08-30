import fs from 'fs';

const file = 'src/server/signals/Gate7FinalTradeValidation.ts';
let content = fs.readFileSync(file, 'utf8');

const patch = `
    const canonicalRR = RiskRewardCalculator.calculate(ctx.entryPrice, ctx.stopLoss, tp1, tp2, tp3, ctx.direction);

    if (isNaN(canonicalRR.grossRR) || !isFinite(canonicalRR.grossRR) || canonicalRR.grossRR < minRR) {
      g9Passed = false;
      g9Reason = \`REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (\${canonicalRR.grossRR.toFixed(2)}:1) is below \${minRR}:1 minimum acceptable GROSS R:R\`;
    }

    hardGates.push({
      id: 9,
      code: 'MIN_ACCEPTABLE_RR',
      name: 'Minimum Acceptable R:R',
      passed: g9Passed,
      reason: g9Reason,
      data: { effectiveRR: canonicalRR.grossRR, minRR, calculatedGrossRR: canonicalRR.grossRR },
    });
`;

content = content.replace(
  /const rrResult = RiskRewardCalculator\.calculate\(ctx\.entryPrice, ctx\.stopLoss, tp1, tp2, tp3, ctx\.direction\);\s+const calculatedGrossRR = rrResult\.grossRR;\s+if \(isNaN\(calculatedGrossRR\) \|\| !isFinite\(calculatedGrossRR\) \|\| calculatedGrossRR < minRR\) \{\s+g9Passed = false;\s+g9Reason = `Risk-to-reward ratio \(\$\{calculatedGrossRR\.toFixed\(2\)\}\) is below required minimum \(\$\{minRR\}\)\.`;\s+\}\s+hardGates\.push\(\{\s+id: 9,\s+code: 'MIN_ACCEPTABLE_RR',\s+name: 'Minimum Acceptable R:R',\s+passed: g9Passed,\s+reason: g9Reason,\s+data: \{ effectiveRR: calculatedGrossRR, minRR, calculatedGrossRR \},\s+\}\);/m,
  patch
);

fs.writeFileSync(file, content);
console.log('Patched Gate7FinalTradeValidation.ts');
