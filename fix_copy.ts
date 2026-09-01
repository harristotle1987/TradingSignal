import fs from 'fs';

const file = 'src/components/AssetClassScanner.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /({best.direction === 'BUY' \? \([^]*?\) : \([^]*?\)}\s*)<\/div>\s*<CopySignalButton signal={best} precision={bestPrec} \/>/m,
  `$1<CopySignalButton signal={best} precision={bestPrec} />\n                  </div>`
);

content = content.replace(
  /({second.direction === 'BUY' \? \([^]*?\) : \([^]*?\)}\s*)<\/div>\s*<CopySignalButton signal={second} precision={secondPrec} \/>/m,
  `$1<CopySignalButton signal={second} precision={secondPrec} />\n                  </div>`
);

content = content.replace(
  /({sug.direction === 'BUY' \? \([^]*?\) : \([^]*?\)}\s*)<\/div>\s*<CopySignalButton signal={sug} precision={sugPrec} \/>/g,
  `$1<CopySignalButton signal={sug} precision={sugPrec} />\n                                  </div>`
);

fs.writeFileSync(file, content);
console.log('Fixed button placement');
