const fs = require('fs');
const f = 'src/components/admin/email/AdminEmailCenter.tsx';
let c = fs.readFileSync(f, 'utf8');

// Find the last occurrence of ');' followed by newline and '};'
// at the top level (the AdminEmailCenter component closing)
// We look for the pattern: />\r\n);\r\n};\r\n\r\n// Simple icon
const marker = '  />\r\n);\r\n};\r\n\r\n// Simple icon';
const replacement = '  />\r\n    </>\r\n  );\r\n};\r\n\r\n// Simple icon';

if (c.includes(marker)) {
  c = c.replace(marker, replacement);
  fs.writeFileSync(f, c, 'utf8');
  console.log('Fixed fragment closing tag');
} else {
  // Try unix line endings
  const markerLF = '  />\n);\n};\n\n// Simple icon';
  const replacementLF = '  />\n    </>\n  );\n};\n\n// Simple icon';
  if (c.includes(markerLF)) {
    c = c.replace(markerLF, replacementLF);
    fs.writeFileSync(f, c, 'utf8');
    console.log('Fixed (LF version)');
  } else {
    console.log('Pattern not found, current tail:');
    const idx = c.indexOf('// Simple icon');
    console.log(JSON.stringify(c.substring(idx - 50, idx + 20)));
  }
}
