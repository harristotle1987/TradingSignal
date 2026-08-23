const fs = require('fs');
let code = fs.readFileSync('src/server/signals/SignalEngine.ts', 'utf8');

const regex = /if \(aiRejected\) \{(\s|.)*?continue;\n\s*\}/m;

const replacement = `if (aiRejected) {
          logger.info(\`[Stage 3 AI] AI evaluation was negative (\${aiRejectionReason}), but GATE 80 policy prevents secondary analytics from rejecting a valid core signal.\`);
          // Note: We intentionally do NOT continue/reject here. AI rejection will simply reduce the ranking score.
          aiRejectionReason = undefined; // Clear the rejection reason so it doesn't leak into UI as a failure
        }`;

if (regex.test(code)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('src/server/signals/SignalEngine.ts', code);
    console.log("Success");
} else {
    console.log("Regex mismatch");
}
