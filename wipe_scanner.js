const fs = require('fs');
const data = JSON.parse(fs.readFileSync('scanner_persistence.json', 'utf8'));
data.sentSignals = [];
data.notifications = [];
data.rejectedCandidates = [];
fs.writeFileSync('scanner_persistence.json', JSON.stringify(data, null, 2));
