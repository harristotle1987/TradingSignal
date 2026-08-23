const fs = require('fs');
let code = fs.readFileSync('src/server/signals/HourlyScanner.ts', 'utf8');

code = code.replace(
  "const result = await signalEngine.generateSignal(category, category);",
  "const result = await signalEngine.generateSignal(category, category, false);"
);

fs.writeFileSync('src/server/signals/HourlyScanner.ts', code);
console.log("Success");
