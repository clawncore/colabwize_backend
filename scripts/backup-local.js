#!/usr/bin/env node
/**
 * Local Database Backup Script
 *
 * Creates both custom-format dump (for pg_restore) and plain SQL (for inspection).
 * Stores in ./backups/ (gitignored). Keeps last N dumps.
 *
 * Usage:
 *   node scripts/backup-local.js                 # default: keep 30
 *   node scripts/backup-local.js --keep 7        # keep last 7
 *   node scripts/backup-local.js --dir /tmp      # custom output dir
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Load .env
import dotenv from 'dotenv';
dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });

const DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ No DATABASE_URL or DIRECT_URL found in .env');
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { keep: 30, dir: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keep' && i + 1 < args.length) {
      result.keep = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dir' && i + 1 < args.length) {
      result.dir = resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Local Database Backup

Usage:
  npm run backup:local              # keep last 30
  npm run backup:local -- --keep 7
  npm run backup:local -- --dir /path/to/backups
`);
      process.exit(0);
    }
  }
  return result;
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: 'inherit', ...opts });
  } catch (err) {
    console.error(`❌ Command failed: ${cmd}`);
    throw err;
  }
}

function main() {
  const { keep, dir: customDir } = parseArgs();
  const BACKUP_DIR = customDir || resolve(PROJECT_ROOT, 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = `colabwize-${timestamp}`;

  // Ensure backup directory exists
  run(`mkdir -p "${BACKUP_DIR}"`);

  console.log(`📂 Backup directory: ${BACKUP_DIR}`);
  console.log(`🔗 Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`⏱️  Timestamp: ${timestamp}`);

  // Custom format (best for pg_restore)
  const dumpFile = join(BACKUP_DIR, `${baseName}.dump`);
  console.log(`\n📦 Creating custom-format dump: ${baseName}.dump`);
  run(`pg_dump --format=custom --file="${dumpFile}" "${DATABASE_URL}"`);

  // Plain SQL (human-readable, grep-able)
  const sqlFile = join(BACKUP_DIR, `${baseName}.sql`);
  console.log(`\n📄 Creating plain SQL dump: ${baseName}.sql`);
  run(`pg_dump --format=plain --file="${sqlFile}" "${DATABASE_URL}"`);

  // Compress plain SQL
  console.log(`\n🗜️  Compressing SQL...`);
  run(`gzip -f "${sqlFile}"`);

  // Prune old backups
  console.log(`\n🧹 Pruning to keep last ${keep} backups...`);
  const dumps = require('fs').readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('colabwize-') && f.endsWith('.dump'))
    .sort()
    .reverse();
  for (const f of dumps.slice(keep)) {
    const full = join(BACKUP_DIR, f);
    require('fs').unlinkSync(full);
    console.log(`   removed ${f}`);
    // Also remove matching .sql.gz
    const sqlGz = f.replace('.dump', '.sql.gz');
    const sqlGzPath = join(BACKUP_DIR, sqlGz);
    if (require('fs').existsSync(sqlGzPath)) {
      require('fs').unlinkSync(sqlGzPath);
    }
  }

  const size = (require('fs').statSync(dumpFile).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ Backup complete: ${baseName}.dump (${size} MB)`);
  console.log(`   Also: ${baseName}.sql.gz`);
  console.log(`\n💡 To restore: pg_restore --clean --if-exists --dbname="<DATABASE_URL>" ${dumpFile}`);
}

main().catch(err => {
  console.error('❌ Backup failed:', err.message);
  process.exit(1);
});