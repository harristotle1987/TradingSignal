const fs = require('fs');
let code = fs.readFileSync('src/server/signals/SignalEngine.ts', 'utf8');

// Fix the undefined 'tradeability' variable at the end of SignalEngine
// since we deleted it in the previous step, it was being used in the logAudit call.
const regex = /threshold: tradeability\.finalRequiredScore,\s*actualScore: sig\.score,\s*marginAboveThreshold: tradeability\.marginAboveFinalThreshold,/g;

if (regex.test(code)) {
    code = code.replace(regex, `threshold: (sig as any).coreScore || sig.score,
            actualScore: sig.score,
            marginAboveThreshold: 0,`);
    fs.writeFileSync('src/server/signals/SignalEngine.ts', code);
    console.log("Success fix logAudit");
} else {
    console.log("Failed fix logAudit");
}
