const fs = require('fs');
let code = fs.readFileSync('src/server/signals/HourlyScanner.ts', 'utf8');

code = code.replace(
  "qualifiedUncorrelated.sort((a, b) => (b.score ?? b.confidenceScore ?? 0) - (a.score ?? a.confidenceScore ?? 0));",
  "qualifiedUncorrelated.sort((a, b) => ((b as any).rankingScore ?? b.score ?? b.confidenceScore ?? 0) - ((a as any).rankingScore ?? a.score ?? a.confidenceScore ?? 0));"
);

fs.writeFileSync('src/server/signals/HourlyScanner.ts', code);
console.log("Success");
