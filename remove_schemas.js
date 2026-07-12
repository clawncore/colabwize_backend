const fs = require('fs');
const path = './prisma/schema.prisma';
let content = fs.readFileSync(path, 'utf8');

// remove all @@schema("public") from the file
content = content.replace(/[ \t]*@@schema\("public"\)\r?\n/g, '');

fs.writeFileSync(path, content, 'utf8');
console.log('Removed @@schema from all models and enums');
