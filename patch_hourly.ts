import fs from 'fs';

const file = 'src/server/signals/HourlyScanner.ts';
let content = fs.readFileSync(file, 'utf8');

const patch = `
      // 9. Persist rejected candidates audit log
      if (rejectedDuringScan.length > 0) {
        await ScannerPersistence.recordRejectedCandidates(rejectedDuringScan);
        for (const rej of rejectedDuringScan) {
          const match = rej.reason.match(/REJECTED: ([A-Z0-9_]+)/);
          const gate = match ? match[1] : 'OTHER_REJECTION';
          aggregatedRejectionCounts[gate] = (aggregatedRejectionCounts[gate] || 0) + 1;

          const dir: SignalDirection = (rej.direction === 'SELL' ? 'SELL' : 'BUY');
`;

content = content.replace(
  /\/\/ 9\. Persist rejected candidates audit log\s+if \(rejectedDuringScan\.length > 0\) \{\s+await ScannerPersistence\.recordRejectedCandidates\(rejectedDuringScan\);\s+for \(const rej of rejectedDuringScan\) \{\s+const dir: SignalDirection = \(rej\.direction === 'SELL' \? 'SELL' : 'BUY'\);/m,
  patch
);

fs.writeFileSync(file, content);
console.log('Patched HourlyScanner.ts');
