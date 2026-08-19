const fs = require('fs');
const path = './prisma/schema.prisma';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/model \w+ \{[\s\S]*?\n\}/g, match => {
  if (match.includes('@@schema(')) return match;
  return match.replace(/\n\}$/, '\n  @@schema("public")\n}');
});

content = content.replace(/enum \w+ \{[\s\S]*?\n\}/g, match => {
  if (match.includes('@@schema(')) return match;
  return match.replace(/\n\}$/, '\n  @@schema("public")\n}');
});

fs.writeFileSync(path, content, 'utf8');
console.log('Added @@schema to all models and enums');
