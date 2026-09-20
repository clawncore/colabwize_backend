#!/usr/bin/env node
/**
 * Medium → ColabWize BlogPost Import
 *
 * Reads a Medium export ZIP, parses each post HTML (h-entry microformat),
 * uploads embedded images to Supabase Storage, and creates BlogPost records.
 *
 * Usage:
 *   cd backend
 *   npm run import:medium                 # import all published posts
 *   npm run import:medium -- --drafts      # also import drafts
 *   npm run import:medium -- --dry-run     # preview without writing
 *   npm run import:medium -- --zip /path/to/export.zip
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });

// Configure DATABASE_URL like backend does
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

// ── ZIP handling ──────────────────────────────────────────────────────────────
async function loadZip(zipPath) {
  try {
    const mod = await import('node:zip');
    return mod.default ? new mod.default(zipPath) : new mod(zipPath);
  } catch { /* fall through */ }
  const { default: AdmZip } = await import('adm-zip');
  return new AdmZip(zipPath);
}

// ── HTML parsing helpers ──────────────────────────────────────────────────────
function extractHtmlElement(html, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`, 'i'),
    new RegExp(`<${escaped}[^>]+/>`),
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function extractTitle(html) {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) return titleTag[1].trim();
  const h1 = html.match(/<h1[^>]*class="[^"]*p-name[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].trim();
  const h1any = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1any ? h1any[1].trim() : '';
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

function extractAllImages(html) {
  const urls = [];
  const regex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function extractHeroImage(html) {
  const bodyMatch = html.match(/<section[^>]*data-field="body"[^>]*class="e-content"[^>]*>([\s\S]*?)<\/section>/i);
  const searchHtml = bodyMatch ? bodyMatch[1] : html;
  const m = searchHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function cleanContentHtml(html) {
  const bodyMatch = html.match(/<section[^>]*data-field="body"[^>]*class="e-content"[^>]*>([\s\S]*?)<\/section>/i);
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

// ── Date/slug from filename ───────────────────────────────────────────────────
function parseDateFromFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return new Date(match[1] + 'T00:00:00Z');
  return new Date();
}

function slugFromFilename(filename) {
  let name = filename.replace(/^posts\//, '').replace(/^draft_/, '').replace(/\.html$/, '');
  name = name.replace(/-[a-f0-9]{8,}$/, '');
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// ── Category detection ────────────────────────────────────────────────────────
const CATEGORY_KEYWORDS = {
  'Academic Writing': ['academic writing', 'research paper', 'scholarly'],
  'Research Collaboration': ['research collaboration', 'collaborate', 'teamwork', 'co-author', 'coauthor'],
  'Citation Management': ['citation', 'reference management', 'bibliography', 'zotero', 'mendeley'],
  'Research Integrity': ['research integrity', 'academic integrity', 'plagiarism', 'authenticity'],
  'Research Workflows': ['research workflow', 'workflow', 'tool stack', 'research tools', 'organize research'],
  'AI & Research': ['ai', 'artificial intelligence', 'generative ai', 'large language model', 'llm'],
  'Career & Growth': ['career', 'professional development', 'phd life', 'graduate school', 'academic career'],
};

function detectCategory(title, content) {
  const haystack = (title + ' ' + content).toLowerCase();
  const scores = new Map();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) score++;
    }
    if (score > 0) scores.set(cat, score);
  }
  let bestCat = 'Research';
  let bestScore = 0;
  for (const [cat, score] of scores.entries()) {
    if (score > bestScore) { bestCat = cat; bestScore = score; }
  }
  return bestCat;
}

// ── Image handling ────────────────────────────────────────────────────────────
async function getSupabaseClient() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL/KEY env vars');
  return createClient(url, key);
}

async function uploadImageToSupabase(buffer, originalUrl, userId = 'medium-import', projectId = 'blog-images') {
  const supabase = await getSupabaseClient();
  const extension = originalUrl.split('.').pop()?.split('?')[0] || 'jpg';
  const mimeTypes = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  };
  const contentType = mimeTypes[extension.toLowerCase()] || 'image/jpeg';
  const imageId = createHash('md5').update(buffer).digest('hex').slice(0, 12);
  const filePath = `${userId}/${projectId}/${imageId}.${extension}`;

  const { data, error } = await supabase.storage
    .from('uploads')
    .upload(filePath, buffer, { contentType, upsert: true });

  if (error) throw error;
  const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(filePath);
  return urlData.publicUrl;
}

async function downloadImage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ColabWize-Medium-Import/1.0', 'Accept': 'image/*' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error('Unreachable');
}

// ── Main import ───────────────────────────────────────────────────────────────
async function runImport(opts) {
  const zipPath = opts.zipPath || resolve(PROJECT_ROOT, '..', 'medium-export-*.zip');

  let actualZip = zipPath;
  if (zipPath.includes('*')) {
    const projectRoot = resolve(PROJECT_ROOT, '..');
    const matches = readdirSync(projectRoot)
      .filter(f => f.startsWith('medium-export-') && f.endsWith('.zip'));
    if (matches.length === 0) {
      console.error(`No Medium export ZIP found in ${projectRoot}`);
      process.exit(1);
    }
    actualZip = resolve(projectRoot, matches[0]);
    console.log(`Found Medium export: ${matches[0]} (${(readFileSync(actualZip).length / 1024 / 1024).toFixed(2)} MB)`);
  }

  console.log(`Extracting: ${actualZip}`);
  const zipInstance = await loadZip(actualZip);

  let postFiles = [];
  try {
    const entries = zipInstance.getEntries ? zipInstance.getEntries() : [];
    postFiles = entries
      .filter((e) => e.entryName && e.entryName.startsWith('posts/') && e.entryName.endsWith('.html'))
      .map((e) => e.entryName)
      .sort();
  } catch {
    for await (const entry of zipInstance) {
      if (entry.filename?.startsWith('posts/') && entry.filename?.endsWith('.html')) {
        postFiles.push(entry.filename);
      }
    }
    postFiles.sort();
  }

  const draftFiles = postFiles.filter(f => f.startsWith('posts/draft_'));
  const publishedFiles = postFiles.filter(f => !f.startsWith('posts/draft_'));

  console.log(`\nMedium export summary:`);
  console.log(`  Published posts: ${publishedFiles.length}`);
  console.log(`  Draft posts:      ${draftFiles.length}`);
  console.log(`  Total:            ${postFiles.length}`);

  if (!opts.includeDrafts) {
    postFiles = publishedFiles;
    console.log(`\nImporting published posts only (use --drafts to include drafts)`);
  } else {
    console.log(`\nImporting ALL posts including drafts`);
  }

  // Initialize Prisma with the same adapter pattern as the backend
  let prisma;
  if (connectionString) {
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({
      log: ["error"],
      errorFormat: "pretty",
      adapter,
    });
  } else {
    prisma = new PrismaClient();
  }

  /**
   * Deduplicate against ANY pre-existing post (not just legacy 'Medium Import' ones).
   * This matters because the author was changed to 'clawncore' after import: a naive
   * re-import checking only `author: 'Medium Import'` would not find the previously
   * imported rows and would therefore create duplicate slugs/titles.
   */
  const existingPosts = await prisma.blogPost.findMany({
    select: { slug: true, title: true },
  });
  const existingSlugs = new Set(existingPosts.map(p => p.slug));
  const existingTitles = new Set(existingPosts.map(p => p.title.toLowerCase()));

  const results = { created: 0, skipped: 0, failed: 0, errors: [] };

  for (let i = 0; i < postFiles.length; i++) {
    const file = postFiles[i];
    const slug = slugFromFilename(file);
    const dateFromFilename = parseDateFromFilename(file);

    let contentStr;
    try {
      const data = zipInstance.readFile
        ? zipInstance.readFile(file)
        : await zipInstance.read(file);
      contentStr = typeof data === 'string' ? data : data.toString('utf-8');
    } catch (err) {
      console.error(`  Failed to read ${file}: ${err.message}`);
      results.failed++;
      results.errors.push(`${file}: ${err.message}`);
      continue;
    }

    const title = extractTitle(contentStr);
    const excerpt = extractExcerpt(contentStr);
    const publishedAt = extractPublishedAt(contentStr) || dateFromFilename;
    const content = cleanContentHtml(contentStr);

    if (existingSlugs.has(slug) || existingTitles.has(title.toLowerCase())) {
      console.log(`  Skipped (exists): ${title.slice(0, 60)}`);
      results.skipped++;
      continue;
    }

    let imageUrl = null;
    const heroSrc = extractHeroImage(contentStr);
    if (heroSrc) {
      try {
        console.log(`  Downloading image for "${title.slice(0, 40)}..."`);
        const imgBuffer = await downloadImage(heroSrc);
        imageUrl = await uploadImageToSupabase(imgBuffer, heroSrc);
        console.log(`    Uploaded: ${imageUrl}`);
      } catch (err) {
        console.warn(`    Image upload failed, keeping original URL: ${err.message}`);
        imageUrl = heroSrc;
      }
    }

    const isDraft = file.startsWith('posts/draft_');
    const category = detectCategory(title, content);

    console.log(`\n  [${i + 1}/${postFiles.length}] ${title.slice(0, 60)}`);
    console.log(`    Slug: ${slug}`);
    console.log(`    Date: ${publishedAt.toISOString().split('T')[0]}`);
    console.log(`    Category: ${category}`);
    console.log(`    Image: ${imageUrl ? 'uploaded' : 'none'}`);
    console.log(`    Excerpt: ${excerpt.slice(0, 100)}...`);

    if (opts.dryRun) {
      console.log(`    [DRY RUN] Would create post`);
      results.created++;
      continue;
    }

    try {
      const blog = await prisma.blogPost.create({
        data: {
          title,
          slug,
          excerpt,
          content,
          author: 'clawncore',
          author_id: null,
          category,
          image: imageUrl,
          read_time: estimateReadTime(content),
          published_at: isDraft ? null : publishedAt,
          is_published: !isDraft,
          view_count: 0,
          read_count: 0,
          like_count: 0,
        },
      });
      console.log(`    Created: ${blog.id}`);
      results.created++;
    } catch (err) {
      console.error(`    Failed: ${err.message}`);
      results.failed++;
      results.errors.push(`${slug}: ${err.message}`);
    }
  }

  await prisma.$disconnect();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Import complete:`);
  console.log(`  Created: ${results.created}`);
  console.log(`  Skipped: ${results.skipped}`);
  console.log(`  Failed:  ${results.failed}`);
  if (results.errors.length) {
    console.log(`\nErrors:`);
    results.errors.forEach(e => console.log(`  ${e}`));
  }
}

function estimateReadTime(content) {
  const text = content.replace(/<[^>]+>/g, ' ');
  const words = text.split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    includeDrafts: args.includes('--drafts'),
    zipPath: args.find(a => a.startsWith('--zip='))?.split('=')[1] || null,
  };
}

const opts = parseArgs();
console.log(`\nMedium → ColabWize Import`);
console.log(`  Mode: ${opts.dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log(`  ZIP:  ${opts.zipPath || 'medium-export-*.zip in project root'}`);
console.log('');

runImport(opts).catch(err => {
  console.error('\nImport crashed:', err);
  process.exit(1);
});