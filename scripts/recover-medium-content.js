#!/usr/bin/env node
/**
 * Medium Blog Content Recovery Script
 *
 * Re-extracts content from the original Medium export HTML files and updates
 * the BlogPost records that were truncated during the initial import.
 *
 * The original import used a non-greedy regex that stopped at the first
 * inner </section>, truncating most articles at ~100 words. This script
 * re-runs extraction with the fixed (greedy) regex and updates the database.
 *
 * Usage:
 *   cd backend
 *   node scripts/recover-medium-content.js            # writes to DB
 *   node scripts/recover-medium-content.js --dry-run   # preview only
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });

// Reuse the Medium export directory
const EXPORT_DIR = resolve(PROJECT_ROOT, '..',
  'medium-export-6a1dc528d302e50ca31a4db279de25209982996887f7304b8aabd49445bd6d15',
  'posts'
);

// ─── Re-use parsing functions from import-medium.js (now fixed) ───────────────────

function extractTitle(html) {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) return titleTag[1].trim();
  const h1 = html.match(/<h1[^>]*class="[^"]*p-name[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].trim();
  const h1any = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1any ? h1any[1].trim() : '';
}

function slugFromFilename(filename) {
  let name = filename.replace(/^posts\//, '').replace(/^draft_/, '').replace(/\.html$/, '');
  name = name.replace(/-[a-f0-9]{8,}$/, '');
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function extractHeroImage(html) {
  const bodyMatch = html.match(/<section[^>]*data-field="body"[^>]*class="e-content"[^>]*>([\s\S]*)<\/section>\s*<\/footer>/i);
  const searchHtml = bodyMatch ? bodyMatch[1] : html;
  const m = searchHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
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

function extractExcerpt(html) {
  const m = html.match(/<section[^>]*data-field="subtitle"[^>]*class="p-summary"[^>]*>([\s\S]*?)<\/section>/i);
  if (m) return m[1].trim();
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return p ? p[1].trim().slice(0, 300) : '';
}

function extractPublishedAt(html) {
  const m = html.match(/<time[^>]*class="dt-published"[^>]*datetime="([^"]+)"/i);
  if (m) return new Date(m[1]);
  const m2 = html.match(/<time[^>]*datetime="([^"]+)"/i);
  return m2 ? new Date(m2[1]) : null;
}

// ─── DB setup ────────────────────────────────────────────────────────────────────

let connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.port === "6543" && !url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "20");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "60");
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "30");
    }
    process.env.DATABASE_URL = url.toString();
    connectionString = url.toString();
  } catch (e) { /* ignore */ }
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg({ pool });
const prisma = new PrismaClient({ adapter });

// ─── Main ────────────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const files = readdirSync(EXPORT_DIR).filter(f => f.endsWith('.html')).sort();
  console.log(`Found ${files.length} HTML files in export directory`);
  console.log(isDryRun ? 'DRY RUN MODE — no database changes will be made\n' : '\n');

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = resolve(EXPORT_DIR, file);
    const html = readFileSync(filePath, 'utf8');
    const slug = slugFromFilename(file);

    try {
      // Look up the existing blog post by slug
      const existing = await prisma.blogPost.findUnique({
        where: { slug },
        select: { id: true, slug: true, content: true }
      });

      if (!existing) {
        console.log(`  ⚠  ${slug} — no matching BlogPost in DB, skipping`);
        missing++;
        continue;
      }

      const newContent = cleanContentHtml(html);
      const newWordCount = newContent.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(w => w).length;
      const oldWordCount = existing.content ? existing.content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(w => w).length : 0;

      // Only update if content actually changed
      if (existing.content === newContent) {
        console.log(`  ✓ ${slug} — already has full content (${newWordCount} words), skipping`);
        skipped++;
        continue;
      }

      console.log(`  ${existing.content ? 'FIXING' : 'ADDING'}: ${slug} — ${oldWordCount} → ${newWordCount} words`);

      if (!isDryRun) {
        await prisma.blogPost.update({
          where: { slug },
          data: { content: newContent }
        });
      }
      updated++;
    } catch (err) {
      console.error(`  ✗ ERROR on ${file}:`, err.message);
      errors++;
    }
  }

  console.log(`\n=== Recovery Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Already complete: ${skipped}`);
  console.log(`No matching DB record: ${missing}`);
  console.log(`Errors: ${errors}`);

  await prisma.$disconnect();
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
