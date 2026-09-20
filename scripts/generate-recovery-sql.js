#!/usr/bin/env node
/**
 * Medium Blog Content Recovery — SQL Generator
 *
 * Generates a SQL file to update BlogPost content from the original Medium
 * export HTML files. This avoids needing a live DB connection in the current
 * context — the SQL can be reviewed and executed separately.
 *
 * Usage:
 *   cd backend
 *   node scripts/generate-recovery-sql.js
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const EXPORT_DIR = resolve(PROJECT_ROOT, '..',
  'medium-export-6a1dc528d302e50ca31a4db279de25209982996887f7304b8aabd49445bd6d15',
  'posts'
);

const OUTPUT_FILE = resolve(PROJECT_ROOT, 'sql', 'recover_medium_content.sql');

function slugFromFilename(filename) {
  let name = filename.replace(/^posts\//, '').replace(/^draft_/, '').replace(/\.html$/, '');
  name = name.replace(/-[a-f0-9]{8,}$/, '');
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function cleanContentHtml(html) {
  // Greedy match captures the entire body section content
  // The body section closes with </section>\n</section> before <footer>
  const bodyMatch = html.match(/<section[^>]*data-field="body"[^>]*class="e-content"[^>]*>([\s\S]*)>\s*<\/section>\s*<\/section>\s*<footer>/i);
  let content = bodyMatch ? bodyMatch[1] : html;

  content = content.replace(/<section[^>]*class="section[^"]*"[^>]*>([\s\S]*?)<\/section>/gi, (match, inner) => {
    inner = inner.replace(/<div[^>]*class="section-divider"[^>]*>[\s\S]*?<\/div>/gi, '');
    inner = inner.replace(/<div[^>]*class="section-inner[^"]*"[^>]*>|<\/div>/gi, '');
    inner = inner.replace(/<div[^>]*class="section-content"[^>]*>|<\/div>/gi, '');
    return inner;
  });

  content = content.replace(/<p[^>]*>\s*<\/p>/gi, '');
  content = content.replace(/<div[^>]*>\s*<\/div>/gi, '');

  content = content.replace(/\s+data-[^=]+="[^"]*"/gi, '');
  content = content.replace(/\s+data-[^=]+=[^\s>]+/gi, '');
  content = content.replace(/\s+name="[^"]*"/gi, '');
  content = content.replace(/\s+id="[^"]*"/gi, '');
  content = content.replace(/\s+class="[^"]*graf[^"]*"/gi, '');
  content = content.replace(/\s+class="[^"]*markup[^"]*"/gi, '');
  content = content.replace(/\s+class="sectionLayout--insetColumn"/gi, '');
  content = content.replace(/\s+class="[^"]*section[^"]*"/gi, '');
  content = content.replace(/\s+style="[^"]*"/gi, '');

  content = content.replace(/&nbsp;/g, ' ');
  content = content.replace(/&/g, '&');
  content = content.replace(/</g, '<');
  content = content.replace(/>/g, '>');
  content = content.replace(/"/g, '"');
  content = content.replace(/'/g, "'");
  content = content.replace(/&mdash;/g, '—');
  content = content.replace(/&ndash;/g, '–');
  content = content.replace(/&hellip;/g, '…');

  content = content.replace(/\n{3,}/g, '\n\n');

  return content.trim();
}

function escapeSql(str) {
  return str.replace(/'/g, "''").replace(/\0/g, '');
}

const files = readdirSync(EXPORT_DIR).filter(f => f.endsWith('.html')).sort();
console.log(`Found ${files.length} HTML files in export directory`);

let sqlStatements = [];
let updated = 0;

for (const file of files) {
  const filePath = resolve(EXPORT_DIR, file);
  const html = readFileSync(filePath, 'utf8');
  const slug = slugFromFilename(file);
  const content = cleanContentHtml(html);
  const wordCount = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(w => w).length;

  if (wordCount === 0) {
    console.log(`  ⚠  ${slug} — empty content, skipping`);
    continue;
  }

  const escapedContent = escapeSql(content);
  sqlStatements.push(
    `UPDATE blog_posts SET content = '${escapedContent}' WHERE slug = '${slug}';`
  );
  updated++;
  console.log(`  ✓ ${slug} — ${wordCount} words`);
}

const sqlOutput = `-- Medium Content Recovery SQL
-- Generated: ${new Date().toISOString()}
-- Fixes truncated blog post content from the non-greedy regex bug in import-medium.js
--
-- Root cause: The original regex used ([\\s\\S]*?) (non-greedy) which stopped at
-- the first inner </section>, truncating articles that had multiple <section> blocks.
-- Fix: Changed to greedy match with </footer> boundary anchor.
--
-- Usage:
--   psql $DATABASE_URL -f backend/sql/recover_medium_content.sql
--   (or review and run manually)

${sqlStatements.join('\n')}
`;

writeFileSync(OUTPUT_FILE, sqlOutput);
console.log(`\n=== Summary ===`);
console.log(`Processed: ${files.length}`);
console.log(`SQL statements: ${updated}`);
console.log(`SQL written to: ${OUTPUT_FILE}`);
