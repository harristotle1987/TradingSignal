import fs from 'fs';

const file = 'src/components/SignalHistoryPanel.tsx';
let content = fs.readFileSync(file, 'utf8');

const componentCode = `
function CopySignalButton({ signal, precision }: { signal: any, precision: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: any) => {
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
      className={\`p-1 rounded transition min-h-[28px] min-w-[28px] flex items-center justify-center shadow-sm \${
        copied 
          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 cursor-default' 
          : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer'
      }\`}
      title="Copy Signal Details"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}
`;

if (!content.includes('function CopySignalButton')) {
  content = content.replace('interface SignalHistoryPanelProps {', componentCode + '\ninterface SignalHistoryPanelProps {');
  
  // Now add the button to the header
  content = content.replace(
    /({isExpanded \? <ChevronUp className="w-3.5 h-3.5" \/> : <ChevronDown className="w-3.5 h-3.5" \/>}\s*<\/button>)/m,
    `$1\n                    <CopySignalButton signal={item} precision={getDynamicPrecision(item.entryPrice, item.symbol)} />`
  );

  fs.writeFileSync(file, content);
  console.log('Inserted CopySignalButton in SignalHistoryPanel');
}
