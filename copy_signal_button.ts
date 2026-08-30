import fs from 'fs';

const file = 'src/components/AssetClassScanner.tsx';
let content = fs.readFileSync(file, 'utf8');

const componentCode = `
function CopySignalButton({ signal, precision }: { signal: any, precision: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    let text = \`Symbol: \${signal.symbol} (\${signal.direction})\\n\`;
    text += \`Entry: \${signal.entryPrice ? signal.entryPrice.toFixed(precision) : '--'}\\n\`;
    text += \`Stop Loss: \${signal.stopLoss ? signal.stopLoss.toFixed(precision) : '--'}\\n\`;
    if (signal.tp1 !== undefined) {
      text += \`TP1: \${signal.tp1.toFixed(precision)}\\n\`;
    }
    if (signal.tp2 !== undefined) {
      text += \`TP2: \${signal.tp2.toFixed(precision)}\\n\`;
    }
    if (signal.tp3 !== undefined) {
      text += \`TP3: \${signal.tp3.toFixed(precision)}\\n\`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={\`px-3 py-1.5 rounded-lg border text-sm font-mono font-bold flex items-center gap-1.5 shadow-sm transition-colors \${
        copied 
          ? 'bg-emerald-950 text-emerald-400 border-emerald-800' 
          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
      }\`}
      title="Copy Signal Details"
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

`;

if (!content.includes('function CopySignalButton')) {
  content = content.replace('interface AssetClassScannerProps {', componentCode + 'interface AssetClassScannerProps {');
  fs.writeFileSync(file, content);
  console.log('Inserted CopySignalButton');
}
